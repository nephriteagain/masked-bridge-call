import { config } from "../config/index.js";
import {
  sessionRepository,
  callRepository,
  eventRepository,
} from "../repositories/index.js";
import type { CallStatus, SessionStatus, Session } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { AppError, BadRequestError, NotFoundError, UpstreamError } from "../utils/errors.js";
import {
  VoiceResponse,
  createOutboundCall,
  hangupCall,
} from "./twilio.service.js";

/**
 * Orchestrates the masked-bridge "Call Connect" flow end to end:
 *   heads-up text (stub) → call provider (A) → bridge client (B) →
 *   connected → end → summary, recording every transition to the activity log.
 *
 * Convention: party A is the PROVIDER (the person who clicked "Contact client"),
 * party B is the CLIENT. The public API speaks in provider/client terms; the
 * telephony layer still thinks in A/B legs.
 *
 * All persistence goes through repositories; all telephony through the Twilio
 * service. HTTP concerns stay in the controllers.
 */

function webhookUrl(path: string, sessionId: string): string {
  return `${config.baseUrl}${path}?sessionId=${sessionId}`;
}

/** Session statuses past which no further transition should be applied. */
const TERMINAL_STATUSES: readonly SessionStatus[] = [
  "completed",
  "failed",
  "canceled",
  "declined",
];

function isTerminal(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** The statuses our `calls` table tracks. Twilio's enum is a superset. */
const CALL_STATUSES: readonly CallStatus[] = [
  "queued",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
];

/**
 * Normalize a Twilio call status onto our `CallStatus` enum. Twilio's "initiated"
 * and "answered" map onto our enum; anything we don't track returns null so the
 * caller can skip the write rather than violate the column's enum constraint.
 */
function normalizeCallStatus(twilioStatus: string): CallStatus | null {
  if (twilioStatus === "initiated") return "queued";
  if (twilioStatus === "answered") return "in-progress";
  return (CALL_STATUSES as string[]).includes(twilioStatus)
    ? (twilioStatus as CallStatus)
    : null;
}

/** Append an activity-log entry, best-effort (logging must never fail the flow). */
async function log(
  sessionId: string,
  type: string,
  party: "provider" | "client" | "system" | null,
  message: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await eventRepository.recordEvent({ sessionId, type, party, message, metadata });
  } catch (err) {
    logger.warn("Failed to record event.", { sessionId, type, error: (err as Error).message });
  }
}

/**
 * Move a session to a terminal state, but only if it isn't already terminal — so
 * the flurry of end-of-call webhooks (dial-status, then A's call-status) can't
 * clobber the reason recorded by whichever arrived first. Returns whether it acted.
 */
async function finalize(
  session: Session,
  status: Extract<SessionStatus, "completed" | "failed" | "declined">,
  endReason: string
): Promise<boolean> {
  if (isTerminal(session.status)) return false;
  await sessionRepository.updateSession(session.id, {
    status,
    endReason,
    endedAt: new Date(),
  });
  session.status = status; // keep the in-memory copy consistent for callers
  return true;
}

/**
 * Placeholder for the client heads-up SMS, which is a real function in the parent
 * app. Here it only records the step so the call sequencing stays faithful.
 */
async function sendHeadsUpText(session: Session): Promise<void> {
  logger.info("[stub] Would send heads-up text to client before calling.", {
    sessionId: session.id,
  });
  await log(
    session.id,
    "heads_up_text_sent",
    "client",
    "Heads-up text sent to client before the call."
  );
}

export interface InitiateConnectionResult {
  sessionId: string;
  callSid: string;
  status: string;
}

/**
 * Start a Call Connect call: create the session, send the heads-up text (stub), and
 * place the outbound call to the provider (A). A sees the masked Twilio number, never
 * the client's real number.
 */
export async function initiateConnection(input: {
  partyA?: string;
  partyB?: string;
}): Promise<InitiateConnectionResult> {
  const { partyA, partyB } = input;
  if (!partyA || !partyB) {
    throw new BadRequestError(
      "partyA (provider) and partyB (client) are required (E.164, e.g. +15551234567)"
    );
  }

  const session = await sessionRepository.createSession({ partyA, partyB });
  await log(session.id, "session_created", "system", "Call Connect session created.");
  const sessionId = session.id;

  await sendHeadsUpText(session);

  let call: Awaited<ReturnType<typeof createOutboundCall>>;
  try {
    call = await createOutboundCall({
      to: session.partyA,
      bridgeUrl: webhookUrl("/webhooks/bridge", sessionId),
      statusCallbackUrl: webhookUrl("/webhooks/call-status", sessionId),
    });
  } catch (err) {
    await finalize(session, "failed", "place_call_error");
    await log(sessionId, "call_failed", "system", "Failed to place the call.", {
      error: (err as Error).message,
    });
    logger.error("Failed to create call to provider.", {
      sessionId,
      error: (err as Error).message,
    });
    throw new UpstreamError("Failed to place call", (err as Error).message);
  }

  await sessionRepository.updateSession(sessionId, {
    status: "ringing-a",
    callSid: call.sid,
  });
  await log(sessionId, "call_initiated", "provider", "Calling the provider's phone…", {
    callSid: call.sid,
  });

  // Record the A leg. Best-effort: the call is already placed.
  try {
    await callRepository.createCall({
      sessionId,
      callSid: call.sid,
      leg: "A",
      partyNumber: session.partyA,
      direction: "outbound",
      status: "queued",
    });
  } catch (err) {
    logger.warn("Failed to record provider call leg.", {
      sessionId,
      callSid: call.sid,
      error: (err as Error).message,
    });
  }

  return { sessionId, callSid: call.sid, status: "ringing-a" };
}

/**
 * The provider (A) answered. Build the TwiML that dials the client (B), masked, and
 * records both legs in dual channel. A per-leg statusCallback lets us learn when the
 * client is ringing vs. answered so we can show which party we're waiting on.
 */
export async function buildBridgeTwiml(
  sessionId: string,
  callSid?: string,
  answeredBy?: string
): Promise<string> {
  const session = await sessionRepository.getSession(sessionId);
  const twiml = new VoiceResponse();

  if (!session) {
    twiml.say("Sorry, this session is no longer valid. Goodbye.");
    twiml.hangup();
    return twiml.toString();
  }

  // Provider canceled while their phone was ringing but picked up anyway.
  if (isTerminal(session.status)) {
    twiml.say("This call was canceled. Goodbye.");
    twiml.hangup();
    return twiml.toString();
  }

  // If the provider's voicemail/machine answered, don't bridge the client into it.
  if (answeredBy && (answeredBy.startsWith("machine") || answeredBy === "fax")) {
    logger.info("Provider answered by machine -- not bridging.", { sessionId, answeredBy });
    await finalize(session, "failed", "provider_voicemail");
    await log(
      sessionId,
      "provider_voicemail",
      "provider",
      "Provider's voicemail answered — not connecting the client.",
      { answeredBy }
    );
    if (callSid) {
      await callRepository.upsertCall({
        sessionId,
        callSid,
        leg: "A",
        partyNumber: session.partyA,
        direction: "outbound",
        status: "completed",
        answeredBy,
      });
    }
    twiml.hangup();
    return twiml.toString();
  }

  // Provider answered as a human: the A leg is in progress.
  if (callSid) {
    await callRepository.upsertCall({
      sessionId,
      callSid,
      leg: "A",
      partyNumber: session.partyA,
      direction: "outbound",
      status: "in-progress",
      answeredBy: answeredBy ?? null,
    });
  }
  await log(sessionId, "provider_answered", "provider", "Provider connected. Calling the client…");

  // Bridge to the client. callerId = Twilio number masks the client from the provider.
  // record-from-answer-dual records BOTH legs (channel 1 = provider, channel 2 = client).
  await sessionRepository.updateSession(sessionId, { status: "bridging" });
  const dial = twiml.dial({
    callerId: config.twilio.number,
    timeout: config.ringTimeout,
    answerOnBridge: true, // provider keeps hearing ringback until the client answers
    record: "record-from-answer-dual",
    recordingStatusCallback: webhookUrl("/webhooks/recording", sessionId),
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
    action: webhookUrl("/webhooks/dial-status", sessionId),
    method: "POST",
  });
  // Per-leg status so we can surface "client ringing" then "client answered" live.
  dial.number(
    {
      statusCallback: webhookUrl("/webhooks/party-b-status", sessionId),
      statusCallbackEvent: ["ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    },
    session.partyB
  );

  return twiml.toString();
}

/**
 * Per-leg lifecycle of the call to the CLIENT (B). This is how we know, in real
 * time, whether the client is ringing or has answered — the basis for "which party
 * connected / which we're waiting on" and the "both connected" transition + timer.
 */
export async function handlePartyBStatus(
  sessionId: string,
  status: string,
  callSid?: string
): Promise<void> {
  const session = await sessionRepository.getSession(sessionId);
  if (!session) return;

  const normalized = normalizeCallStatus(status);
  if (callSid && normalized) {
    await callRepository.upsertCall({
      sessionId,
      callSid,
      leg: "B",
      partyNumber: session.partyB,
      direction: "outbound",
      status: normalized,
    });
  }

  if (status === "ringing") {
    await log(sessionId, "client_ringing", "client", "Client's phone is ringing…");
  } else if (status === "answered" || status === "in-progress") {
    // Both parties are now on the line. Anchor the call timer here.
    if (!isTerminal(session.status) && !session.connectedAt) {
      await sessionRepository.updateSession(sessionId, {
        status: "connected",
        connectedAt: new Date(),
      });
      await log(sessionId, "client_answered", "client", "Client answered.");
      await log(
        sessionId,
        "both_connected",
        "system",
        "Both parties connected — call in progress."
      );
    }
  }
}

/**
 * The <Dial> to the client finished. Record the client leg's outcome and, if the
 * client never connected, tell the provider politely instead of dead air.
 * Distinguishes a decline (busy) from other non-answers. Returns TwiML.
 */
export async function handleDialStatus(
  sessionId: string,
  dialStatus: string,
  dialCallSid?: string
): Promise<string> {
  const twiml = new VoiceResponse();
  const session = await sessionRepository.getSession(sessionId);

  if (dialCallSid && session) {
    const status = normalizeCallStatus(dialStatus);
    if (status) {
      await callRepository.upsertCall({
        sessionId,
        callSid: dialCallSid,
        leg: "B",
        partyNumber: session.partyB,
        direction: "outbound",
        status,
      });
    }
  }

  if (!session) {
    twiml.hangup();
    return twiml.toString();
  }

  if (dialStatus === "completed") {
    if (await finalize(session, "completed", "completed")) {
      await log(sessionId, "call_ended", "system", "Call ended normally.");
    }
    twiml.hangup();
    return twiml.toString();
  }

  if (dialStatus === "busy") {
    logger.info("Client declined the call.", { sessionId });
    if (await finalize(session, "declined", "client_declined")) {
      await log(sessionId, "client_declined", "client", "Client declined the call.");
    }
    twiml.say("The other party declined the call. Goodbye.");
    twiml.hangup();
    return twiml.toString();
  }

  // no-answer, failed, canceled
  logger.info("Client not connected.", { sessionId, dialStatus });
  if (await finalize(session, "failed", `client_${dialStatus}`)) {
    await log(sessionId, "client_no_answer", "client", "Client did not answer.", { dialStatus });
  }
  twiml.say("Sorry, we could not reach the other party. Please try again later. Goodbye.");
  twiml.hangup();
  return twiml.toString();
}

/**
 * Lifecycle of the call to the PROVIDER (A). This is where we learn the provider
 * didn't answer (in that case /webhooks/bridge never runs) and keep the A leg current.
 */
export async function handleCallStatus(
  sessionId: string,
  status: string,
  callSid?: string
): Promise<void> {
  const session = await sessionRepository.getSession(sessionId);
  if (!session) return;

  if (callSid) {
    const normalized = normalizeCallStatus(status);
    if (normalized) {
      await callRepository.upsertCall({
        sessionId,
        callSid,
        leg: "A",
        partyNumber: session.partyA,
        direction: "outbound",
        status: normalized,
      });
    }
  }

  if (status === "ringing") {
    await log(sessionId, "provider_ringing", "provider", "Provider's phone is ringing…");
    return;
  }

  if (["no-answer", "busy", "failed", "canceled"].includes(status)) {
    if (await finalize(session, "failed", "provider_no_answer")) {
      logger.info("Provider did not answer.", { sessionId, callStatus: status });
      await log(sessionId, "provider_no_answer", "provider", "Provider did not answer.", {
        callStatus: status,
      });
    }
  } else if (status === "completed") {
    // Only a normal wrap-up; don't override a decline/cancel/failure already recorded.
    if (await finalize(session, "completed", "completed")) {
      await log(sessionId, "call_ended", "system", "Call ended.");
    }
    logger.info("Call finished.", { sessionId });
  }
}

/**
 * The provider cancels a connecting call or leaves an in-progress one (to rejoin the
 * video session). Requires explicit confirmation. Hangs up any still-active leg.
 */
export async function cancelCall(
  sessionId: string,
  confirm: boolean
): Promise<{ sessionId: string; status: SessionStatus }> {
  if (!confirm) {
    throw new AppError(409, "Confirmation required to cancel the call. Send { confirm: true }.");
  }

  const session = await sessionRepository.getSession(sessionId);
  if (!session) throw new NotFoundError("Session not found");
  if (isTerminal(session.status)) {
    throw new BadRequestError("This call has already ended.");
  }

  // Hang up any leg that is still live. Best-effort per leg.
  const calls =
    (session as unknown as { calls?: { callSid: string; status: CallStatus }[] }).calls ?? [];
  const activeCalls = calls.filter((c) =>
    ["queued", "ringing", "in-progress"].includes(c.status)
  );
  for (const c of activeCalls) {
    try {
      await hangupCall(c.callSid);
    } catch (err) {
      logger.warn("Failed to hang up leg during cancel.", {
        sessionId,
        callSid: c.callSid,
        error: (err as Error).message,
      });
    }
  }

  await sessionRepository.updateSession(sessionId, {
    status: "canceled",
    endReason: "provider_canceled",
    endedAt: new Date(),
  });
  await log(
    sessionId,
    "call_canceled",
    "provider",
    "Provider canceled the call and returned to the session."
  );

  return { sessionId, status: "canceled" };
}

// ---------------------------------------------------------------------------
// Read models: derived live status and end-of-call summary.
// ---------------------------------------------------------------------------

type PartyState =
  | "idle"
  | "waiting"
  | "ringing"
  | "connected"
  | "ended"
  | "declined"
  | "no_answer"
  | "failed"
  | "canceled";

export type CallPhase =
  | "starting"
  | "contacting_provider"
  | "contacting_client"
  | "connected"
  | "ended"
  | "client_declined"
  | "canceled"
  | "failed";

const PHASE_BY_STATUS: Record<SessionStatus, CallPhase> = {
  initiated: "starting",
  "ringing-a": "contacting_provider",
  bridging: "contacting_client",
  connected: "connected",
  completed: "ended",
  declined: "client_declined",
  canceled: "canceled",
  failed: "failed",
};

/** Map a Twilio call-leg status onto the simpler per-party state the UI shows. */
function legState(status: CallStatus | undefined, fallback: PartyState): PartyState {
  switch (status) {
    case "queued":
    case "ringing":
      return "ringing";
    case "in-progress":
      return "connected";
    case "completed":
      return "ended";
    case "busy":
      return "declined";
    case "no-answer":
      return "no_answer";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return fallback;
  }
}

function messageForPhase(phase: CallPhase, endReason: string | null): string | null {
  switch (phase) {
    case "connected":
      return "Both parties are connected. The call is in progress and being recorded.";
    case "contacting_provider":
      return "Calling your phone. Answer to connect to your client.";
    case "contacting_client":
      return "You're connected. Ringing your client — hang tight.";
    case "client_declined":
      return "Your client declined the call. You can return to the session and try again.";
    case "canceled":
      return "Call canceled. You've returned to the session.";
    case "ended":
      return "The call has ended and is being documented.";
    case "failed":
      return endReason === "provider_voicemail"
        ? "Your voicemail picked up, so we didn't connect the client."
        : "We couldn't complete the call. Please try again.";
    default:
      return null;
  }
}

export interface LiveStatus {
  sessionId: string;
  phase: CallPhase;
  status: SessionStatus;
  message: string | null;
  parties: {
    provider: { state: PartyState; connectedAt: Date | null };
    client: { state: PartyState };
  };
  connectedAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  durationSeconds: number | null;
  transcriptReady: boolean;
  active: boolean;
}

/** Derive the live call status the provider polls: phase, per-party state, timer. */
export async function getLiveStatus(sessionId: string): Promise<LiveStatus> {
  const session = await sessionRepository.getSession(sessionId);
  if (!session) throw new NotFoundError("Session not found");

  const calls =
    (session as unknown as { calls?: { leg: "A" | "B"; status: CallStatus }[] }).calls ?? [];
  const providerLeg = calls.find((c) => c.leg === "A");
  const clientLeg = calls.find((c) => c.leg === "B");

  const phase = PHASE_BY_STATUS[session.status];
  const providerFallback: PartyState = session.status === "initiated" ? "idle" : "ringing";
  const clientFallback: PartyState =
    session.status === "initiated" || session.status === "ringing-a" ? "waiting" : "ringing";

  const durationSeconds = session.connectedAt
    ? Math.max(
        0,
        Math.floor(
          ((session.endedAt ? new Date(session.endedAt).getTime() : Date.now()) -
            new Date(session.connectedAt).getTime()) /
            1000
        )
      )
    : null;

  return {
    sessionId: session.id,
    phase,
    status: session.status,
    message: messageForPhase(phase, session.endReason),
    parties: {
      provider: {
        state: legState(providerLeg?.status, providerFallback),
        connectedAt: session.connectedAt ?? null,
      },
      client: { state: legState(clientLeg?.status, clientFallback) },
    },
    connectedAt: session.connectedAt ?? null,
    endedAt: session.endedAt ?? null,
    endReason: session.endReason ?? null,
    durationSeconds,
    transcriptReady: Array.isArray(session.ciTranscript) && session.ciTranscript.length > 0,
    active: !isTerminal(session.status),
  };
}

export interface CallSummary {
  sessionId: string;
  outcome: SessionStatus;
  endReason: string | null;
  connectedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  documented: { recorded: boolean; transcribed: boolean };
  recordingStatus: string | null;
  transcriptStatus: string | null;
  eventCount: number;
  message: string;
}

/** End-of-call summary the provider sees when the call wraps up. */
export async function getSummary(sessionId: string): Promise<CallSummary> {
  const session = await sessionRepository.getSession(sessionId);
  if (!session) throw new NotFoundError("Session not found");

  const related = session as unknown as {
    recording?: { status: string } | null;
    transcript?: { status: string } | null;
    events?: unknown[];
  };

  const durationSeconds =
    session.connectedAt && session.endedAt
      ? Math.max(
          0,
          Math.floor(
            (new Date(session.endedAt).getTime() - new Date(session.connectedAt).getTime()) / 1000
          )
        )
      : null;

  const transcribed = Array.isArray(session.ciTranscript) && session.ciTranscript.length > 0;

  return {
    sessionId: session.id,
    outcome: session.status,
    endReason: session.endReason ?? null,
    connectedAt: session.connectedAt ?? null,
    endedAt: session.endedAt ?? null,
    durationSeconds,
    documented: {
      recorded: Boolean(session.recordingSid),
      transcribed,
    },
    recordingStatus: related.recording?.status ?? null,
    transcriptStatus: related.transcript?.status ?? (transcribed ? "completed" : null),
    eventCount: related.events?.length ?? 0,
    message:
      session.status === "completed"
        ? "Call wrapped up. Your recording and notes are being documented for this session."
        : messageForPhase(PHASE_BY_STATUS[session.status], session.endReason) ?? "Call ended.",
  };
}
