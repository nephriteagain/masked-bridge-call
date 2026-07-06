import "dotenv/config";

import express, { type NextFunction, type Request, type Response } from "express";
import twilio from "twilio";
import * as store from "./sessions.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_NUMBER,
  BASE_URL,
  PORT = "3000",
  RING_TIMEOUT = "20",
  VALIDATE_TWILIO_REQUESTS = "false",
  USE_MACHINE_DETECTION = "false",
  // Conversation Intelligence Service SID (GAxxxx). Enables post-call transcription
  // of the recording. If unset, the call is still recorded but not auto-transcribed.
  INTELLIGENCE_SERVICE_SID = "",
} = process.env;

for (const [k, v] of Object.entries({
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_NUMBER,
  BASE_URL,
})) {
  if (!v) {
    console.error(`Missing required env var: ${k}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// After the guard above these are guaranteed present; assert for the type system.
const baseUrl = BASE_URL as string;
const twilioNumber = TWILIO_NUMBER as string;
const authToken = TWILIO_AUTH_TOKEN as string;

const ringTimeout = Number(RING_TIMEOUT);
const validateRequests = VALIDATE_TWILIO_REQUESTS === "true";
const useMachineDetection = USE_MACHINE_DETECTION === "true";
const intelligenceServiceSid = INTELLIGENCE_SERVICE_SID.trim();

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const VoiceResponse = twilio.twiml.VoiceResponse;

const app = express();
// Twilio posts webhooks as application/x-www-form-urlencoded.
app.use(express.urlencoded({ extended: false }));
// We also accept JSON on the /connect endpoint that YOUR app calls.
app.use(express.json());

// ---------------------------------------------------------------------------
// Optional: verify each webhook is genuinely from Twilio (recommended in prod).
// Applied only to the webhook routes Twilio calls, not your own /connect route.
// ---------------------------------------------------------------------------
function twilioWebhook(req: Request, res: Response, next: NextFunction) {
  if (!validateRequests) return next();
  const signature = req.header("X-Twilio-Signature") || "";
  const url = baseUrl + req.originalUrl;
  const valid = twilio.validateRequest(authToken, signature, url, req.body);
  if (!valid) {
    console.warn("Rejected request with invalid Twilio signature:", req.originalUrl);
    return res.status(403).send("Invalid signature");
  }
  next();
}

// ---------------------------------------------------------------------------
// 1) YOUR endpoint: start a connection between two real numbers.
//    POST /connect  { "partyA": "+1...", "partyB": "+1..." }
//    -> places the outbound call to A. A sees TWILIO_NUMBER, not B.
// ---------------------------------------------------------------------------
app.post("/connect", async (req: Request, res: Response) => {
  const { partyA, partyB } = (req.body || {}) as { partyA?: string; partyB?: string };
  if (!partyA || !partyB) {
    return res.status(400).json({ error: "partyA and partyB are required (E.164, e.g. +15551234567)" });
  }

  const session = store.createSession({ partyA, partyB });

  try {
    const call = await client.calls.create({
      to: partyA,
      from: twilioNumber, // <-- A sees the masked number
      url: `${baseUrl}/bridge?sessionId=${session.id}`, // run when A answers
      method: "POST",
      timeout: ringTimeout, // ring A this many seconds
      statusCallback: `${baseUrl}/call-status?sessionId=${session.id}`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
      ...(useMachineDetection ? { machineDetection: "Enable" } : {}),
    });

    store.updateSession(session.id, { status: "ringing-a", callSid: call.sid });

    res.json({ sessionId: session.id, callSid: call.sid, status: "ringing-a" });
  } catch (err) {
    store.updateSession(session.id, { status: "failed" });
    console.error("Failed to create call to A:", (err as Error).message);
    res.status(502).json({ error: "Failed to place call", detail: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// 2) Twilio webhook: A has answered. Return TwiML that dials B with
//    TWILIO_NUMBER as caller ID (so B is masked too) and records both legs
//    in dual channel for post-call transcription.
// ---------------------------------------------------------------------------
app.post("/bridge", twilioWebhook, (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const session = store.getSession(sessionId);
  const twiml = new VoiceResponse();

  if (!session) {
    twiml.say("Sorry, this session is no longer valid. Goodbye.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  // Optional: if A's voicemail/machine answered, don't bridge B into it.
  const answeredBy = req.body.AnsweredBy as string | undefined; // present only when machineDetection is on
  if (answeredBy && (answeredBy.startsWith("machine") || answeredBy === "fax")) {
    console.log(`[${sessionId}] A answered by ${answeredBy} -- not bridging.`);
    store.updateSession(sessionId, { status: "failed" });
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  // Bridge to B. callerId = TWILIO_NUMBER masks B from A as well.
  //     record-from-answer-dual records BOTH legs, each on its own channel
  //     (channel 1 = A / parent leg, channel 2 = B / child leg). When the
  //     recording finishes, Twilio POSTs the RecordingSid to /recording, which
  //     kicks off post-call transcription via Conversation Intelligence.
  //     The action URL fires when this dial leg ends (answered, busy, no-answer...).
  store.updateSession(sessionId, { status: "bridging" });
  const dial = twiml.dial({
    callerId: twilioNumber,
    timeout: ringTimeout,
    answerOnBridge: true, // A keeps hearing ringback until B actually answers
    record: "record-from-answer-dual",
    recordingStatusCallback: `${baseUrl}/recording?sessionId=${sessionId}`,
    recordingStatusCallbackEvent: ["completed"],
    recordingStatusCallbackMethod: "POST",
    action: `${baseUrl}/dial-status?sessionId=${sessionId}`,
    method: "POST",
  });
  dial.number(session.partyB);

  res.type("text/xml").send(twiml.toString());
});

// ---------------------------------------------------------------------------
// 3) Twilio webhook: the <Dial> to B finished. Tells us if B didn't answer.
//    If B never connected, let A know politely instead of dead air.
// ---------------------------------------------------------------------------
app.post("/dial-status", twilioWebhook, (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const dialStatus = req.body.DialCallStatus as string; // completed | busy | no-answer | failed | canceled
  const twiml = new VoiceResponse();

  if (dialStatus !== "completed") {
    console.log(`[${sessionId}] B not connected (DialCallStatus=${dialStatus}).`);
    store.updateSession(sessionId, { status: "failed" });
    twiml.say("Sorry, we could not reach the other party. Please try again later. Goodbye.");
  } else {
    store.updateSession(sessionId, { status: "completed" });
  }
  twiml.hangup();
  res.type("text/xml").send(twiml.toString());
});

// ---------------------------------------------------------------------------
// 4) Twilio webhook: lifecycle of the call to A. This is where we learn that
//    A DIDN'T ANSWER (no-answer / busy / failed / canceled), because in that
//    case /bridge never runs at all.
// ---------------------------------------------------------------------------
app.post("/call-status", twilioWebhook, (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const status = req.body.CallStatus as string; // queued | ringing | in-progress | completed | busy | no-answer | failed | canceled

  if (["no-answer", "busy", "failed", "canceled"].includes(status)) {
    console.log(`[${sessionId}] Party A did not answer (CallStatus=${status}).`);
    store.updateSession(sessionId, { status: "failed" });
    // Hook for your app: notify the requester, retry, schedule a callback, etc.
  } else if (status === "completed") {
    const s = store.getSession(sessionId);
    if (s && s.status !== "failed") store.updateSession(sessionId, { status: "completed" });
    console.log(`[${sessionId}] Call finished.`);
  }

  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// 5) Twilio webhook: the dual-channel recording is ready. Kick off post-call
//    transcription with Conversation Intelligence, referencing the RecordingSid.
//    We pass customerKey = sessionId so the completion webhook (/intelligence)
//    can correlate the finished transcript back to this session.
// ---------------------------------------------------------------------------
app.post("/recording", twilioWebhook, async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const recordingSid = req.body.RecordingSid as string;
  store.updateSession(sessionId, { recordingSid });
  console.log(`[${sessionId}] Recording ready: ${recordingSid}`);

  // Respond to Twilio immediately; do the API call after.
  res.sendStatus(204);

  if (!intelligenceServiceSid) {
    console.log(
      `[${sessionId}] INTELLIGENCE_SERVICE_SID not set -- recording saved but not transcribed.`
    );
    return;
  }

  try {
    const transcript = await client.intelligence.v2.transcripts.create({
      serviceSid: intelligenceServiceSid,
      customerKey: sessionId, // echoed back to /intelligence on completion
      channel: {
        // Transcribe the Twilio recording. Channel 1 = A (parent), 2 = B (child).
        media_properties: { source_sid: recordingSid },
      },
    });
    store.updateSession(sessionId, { transcriptSid: transcript.sid });
    console.log(`[${sessionId}] Transcript requested: ${transcript.sid} (processing async).`);
    // NOTE: if you enable "Auto Transcribe" on the Intelligence Service, every
    // recording is transcribed automatically and you can skip this create call.
  } catch (err) {
    console.error(`[${sessionId}] Failed to create transcript:`, (err as Error).message);
  }
});

// ---------------------------------------------------------------------------
// 6) Conversation Intelligence webhook: fired when a transcript finishes
//    processing. Configure your Intelligence Service's webhook URL to point
//    here (Console -> Conversational Intelligence -> Services -> your service).
//    We fetch the sentences and assemble the final speaker-labeled transcript.
// ---------------------------------------------------------------------------
app.post("/intelligence", twilioWebhook, async (req: Request, res: Response) => {
  // Payload is snake_case; accept a couple of shapes defensively.
  const transcriptSid = (req.body.transcript_sid || req.body.TranscriptSid) as string | undefined;
  const sessionId = (req.body.customer_key || req.body.CustomerKey) as string | undefined;

  // Ack immediately.
  res.sendStatus(204);

  if (!transcriptSid) return;

  try {
    const sentences = await client.intelligence.v2
      .transcripts(transcriptSid)
      .sentences.list();

    const ordered = sentences.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
    const ciTranscript = ordered.map((s) => ({
      // Channel 2 is the dialed leg (B); anything else is A.
      speaker: (s.mediaChannel === 2 ? "B" : "A") as "A" | "B",
      text: s.transcript,
      confidence: s.confidence != null ? Number(s.confidence) : null,
    }));

    if (sessionId) {
      store.updateSession(sessionId, { transcriptSid, ciTranscript });
    }

    const pretty = ciTranscript.map((l) => `${l.speaker}: ${l.text}`).join("\n");
    console.log(`[${sessionId || transcriptSid}] Post-call transcript ready:\n${pretty}`);
    // >>> This is your clean, speaker-labeled "after the call" transcript.
    //     Persist it, email it, run analysis, etc. <<<
  } catch (err) {
    console.error(`Failed to fetch sentences for ${transcriptSid}:`, (err as Error).message);
  }
});

// ---------------------------------------------------------------------------
// 7) Convenience: read back a session's collected transcript (for testing).
//    GET /sessions/:id  -> status + transcript. (Real numbers are NOT returned.)
// ---------------------------------------------------------------------------
app.get("/sessions/:id", (req: Request, res: Response) => {
  const s = store.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json({
    id: s.id,
    status: s.status,
    createdAt: s.createdAt,
    recordingSid: s.recordingSid,
    transcriptSid: s.transcriptSid,
    ciTranscript: s.ciTranscript, // post-call Conversation Intelligence result
  });
});

app.get("/", (_req: Request, res: Response) => res.send("twilio-masked-bridge is running"));

app.listen(Number(PORT), () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Webhooks expect to be reachable at ${baseUrl}`);
  if (!validateRequests) {
    console.log("Twilio signature validation is OFF (set VALIDATE_TWILIO_REQUESTS=true for prod).");
  }
});
