import type { Request, Response } from "express";

import * as callService from "../services/call.service.js";
import * as transcriptService from "../services/transcript.service.js";

/**
 * Twilio-facing webhook handlers. Each is thin: parse the payload, delegate to a
 * service, and respond. TwiML responses are XML; status-only webhooks ack with 204.
 */

/** A answered — return TwiML that dials B (masked) and records both legs. */
export async function bridge(req: Request, res: Response): Promise<void> {
  const sessionId = req.query.sessionId as string;
  const callSid = req.body.CallSid as string | undefined; // the A leg
  const answeredBy = req.body.AnsweredBy as string | undefined; // present only with machine detection
  const twiml = await callService.buildBridgeTwiml(sessionId, callSid, answeredBy);
  res.type("text/xml").send(twiml);
}

/**
 * Per-leg lifecycle of the client (B) call — tells us when the client is ringing vs.
 * answered, so we can show which party we're waiting on and detect "both connected".
 */
export async function partyBStatus(req: Request, res: Response): Promise<void> {
  const sessionId = req.query.sessionId as string;
  const status = req.body.CallStatus as string;
  const callSid = req.body.CallSid as string | undefined; // the B (child) leg
  await callService.handlePartyBStatus(sessionId, status, callSid);
  res.sendStatus(204);
}

/** The <Dial> to B finished — record the B leg and handle "B didn't answer". */
export async function dialStatus(req: Request, res: Response): Promise<void> {
  const sessionId = req.query.sessionId as string;
  const status = req.body.DialCallStatus as string;
  const dialCallSid = req.body.DialCallSid as string | undefined; // the B leg
  const twiml = await callService.handleDialStatus(sessionId, status, dialCallSid);
  res.type("text/xml").send(twiml);
}

/** Lifecycle of the call to A — keep the A leg current, handle "A didn't answer". */
export async function callStatus(req: Request, res: Response): Promise<void> {
  const sessionId = req.query.sessionId as string;
  const status = req.body.CallStatus as string;
  const callSid = req.body.CallSid as string | undefined; // the A leg
  await callService.handleCallStatus(sessionId, status, callSid);
  res.sendStatus(204);
}

/**
 * The dual-channel recording is ready. Ack immediately, then persist and kick off
 * transcription asynchronously so we never hold Twilio's request open on our API calls.
 */
export async function recording(req: Request, res: Response): Promise<void> {
  const sessionId = req.query.sessionId as string;
  const recordingSid = req.body.RecordingSid as string;
  res.sendStatus(204);
  await transcriptService.handleRecordingReady(sessionId, recordingSid);
}

/**
 * Conversation Intelligence finished processing a transcript. Ack immediately, then
 * assemble and persist the speaker-labeled transcript.
 */
export async function intelligence(req: Request, res: Response): Promise<void> {
  // Payload is snake_case; accept a couple of shapes defensively.
  const transcriptSid = (req.body.transcript_sid || req.body.TranscriptSid) as string | undefined;
  const sessionId = (req.body.customer_key || req.body.CustomerKey) as string | undefined;
  res.sendStatus(204);
  if (!transcriptSid) return;
  await transcriptService.handleTranscriptComplete(transcriptSid, sessionId);
}
