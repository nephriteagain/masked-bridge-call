import { config } from "../config/index.js";
import { sessionRepository, callRepository } from "../repositories/index.js";
import type { CallStatus } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { BadRequestError, UpstreamError } from "../utils/errors.js";
import {
  VoiceResponse,
  createOutboundCall,
} from "./twilio.service.js";

/**
 * Orchestrates the masked-bridge call flow: placing the outbound call to A,
 * generating the TwiML that dials B, and reconciling the various status webhooks.
 * All persistence goes through the repositories; all telephony through the Twilio
 * service. HTTP concerns stay in the controllers.
 */

function webhookUrl(path: string, sessionId: string): string {
  return `${config.baseUrl}${path}?sessionId=${sessionId}`;
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
 * maps to "queued"; anything we don't track returns null so the caller can skip
 * the write rather than violate the column's enum constraint.
 */
function normalizeCallStatus(twilioStatus: string): CallStatus | null {
  if (twilioStatus === "initiated") return "queued";
  return (CALL_STATUSES as string[]).includes(twilioStatus)
    ? (twilioStatus as CallStatus)
    : null;
}

export interface InitiateConnectionResult {
  sessionId: string;
  callSid: string;
  status: string;
}

/**
 * Create a session and place the outbound call to Party A. A sees the masked
 * Twilio number, never B's real number.
 */
export async function initiateConnection(input: {
  partyA?: string;
  partyB?: string;
}): Promise<InitiateConnectionResult> {
  const { partyA, partyB } = input;
  if (!partyA || !partyB) {
    throw new BadRequestError(
      "partyA and partyB are required (E.164, e.g. +15551234567)"
    );
  }

  const session = await sessionRepository.createSession({ partyA, partyB });

  let call: Awaited<ReturnType<typeof createOutboundCall>>;
  try {
    call = await createOutboundCall({
      to: partyA,
      bridgeUrl: webhookUrl("/webhooks/bridge", session.id),
      statusCallbackUrl: webhookUrl("/webhooks/call-status", session.id),
    });
  } catch (err) {
    await sessionRepository.updateSession(session.id, { status: "failed" });
    logger.error("Failed to create call to A.", {
      sessionId: session.id,
      error: (err as Error).message,
    });
    throw new UpstreamError("Failed to place call", (err as Error).message);
  }

  await sessionRepository.updateSession(session.id, {
    status: "ringing-a",
    callSid: call.sid,
  });

  // Record the A leg. Best-effort: the call is already placed, so a bookkeeping
  // failure here must not fail the request.
  try {
    await callRepository.createCall({
      sessionId: session.id,
      callSid: call.sid,
      leg: "A",
      partyNumber: partyA,
      direction: "outbound",
    });
  } catch (err) {
    logger.warn("Failed to record A call leg.", {
      sessionId: session.id,
      callSid: call.sid,
      error: (err as Error).message,
    });
  }

  return { sessionId: session.id, callSid: call.sid, status: "ringing-a" };
}

/**
 * A has answered. Build the TwiML that dials B (masked) and records both legs in
 * dual channel for post-call transcription. Returns a TwiML XML string.
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

  // If A's voicemail/machine answered, don't bridge B into it.
  if (answeredBy && (answeredBy.startsWith("machine") || answeredBy === "fax")) {
    logger.info("Party A answered by machine -- not bridging.", { sessionId, answeredBy });
    await sessionRepository.updateSession(sessionId, { status: "failed" });
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

  // A answered as a human: the A leg is now in progress. Record answeredBy too
  // (present only when machine detection is enabled).
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

  // Bridge to B. callerId = Twilio number masks B from A as well.
  // record-from-answer-dual records BOTH legs (channel 1 = A, channel 2 = B).
  // When the recording finishes Twilio POSTs to /webhooks/recording.
  await sessionRepository.updateSession(sessionId, { status: "bridging" });
  const dial = twiml.dial({
    callerId: config.twilio.number,
    timeout: config.ringTimeout,
    answerOnBridge: true, // A keeps hearing ringback until B answers
    record: "record-from-answer-dual",
    recordingStatusCallback: webhookUrl("/webhooks/recording", sessionId),
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
    action: webhookUrl("/webhooks/dial-status", sessionId),
    method: "POST",
  });
  dial.number(session.partyB);

  return twiml.toString();
}

/**
 * The <Dial> to B finished. Record the B leg's outcome and, if B never connected,
 * tell A politely instead of dead air. Returns a TwiML XML string.
 */
export async function handleDialStatus(
  sessionId: string,
  dialStatus: string,
  dialCallSid?: string
): Promise<string> {
  const twiml = new VoiceResponse();

  // Record the B leg. This is the first webhook that carries B's own Call SID.
  if (dialCallSid) {
    const session = await sessionRepository.getSession(sessionId);
    const status = normalizeCallStatus(dialStatus);
    if (session && status) {
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

  if (dialStatus !== "completed") {
    logger.info("Party B not connected.", { sessionId, dialStatus });
    await sessionRepository.updateSession(sessionId, { status: "failed" });
    twiml.say("Sorry, we could not reach the other party. Please try again later. Goodbye.");
  } else {
    await sessionRepository.updateSession(sessionId, { status: "completed" });
  }
  twiml.hangup();
  return twiml.toString();
}

/**
 * Lifecycle of the call to A. This is where we learn A didn't answer, because in
 * that case /webhooks/bridge never runs. Also keeps the A call leg's status current.
 */
export async function handleCallStatus(
  sessionId: string,
  status: string,
  callSid?: string
): Promise<void> {
  // Keep the A call leg's status in sync across the lifecycle events.
  if (callSid) {
    const normalized = normalizeCallStatus(status);
    const session = await sessionRepository.getSession(sessionId);
    if (session && normalized) {
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

  if (["no-answer", "busy", "failed", "canceled"].includes(status)) {
    logger.info("Party A did not answer.", { sessionId, callStatus: status });
    await sessionRepository.updateSession(sessionId, { status: "failed" });
    // Hook for your app: notify the requester, retry, schedule a callback, etc.
  } else if (status === "completed") {
    const session = await sessionRepository.getSession(sessionId);
    if (session && session.status !== "failed") {
      await sessionRepository.updateSession(sessionId, { status: "completed" });
    }
    logger.info("Call finished.", { sessionId });
  }
}
