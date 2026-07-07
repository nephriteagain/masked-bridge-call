import twilio from "twilio";

import { config } from "../config/index.js";

/**
 * Thin wrapper around the Twilio SDK. Owns the single shared client instance and
 * exposes only the operations this application needs, so call sites never touch the
 * raw SDK surface (and can be mocked easily in tests).
 */
const client = twilio(config.twilio.apiKeySid, config.twilio.apiKeySecret, {
  accountSid: config.twilio.accountSid,
});

export const VoiceResponse = twilio.twiml.VoiceResponse;

/**
 * Validate that a webhook request was genuinely signed by Twilio.
 */
export function isValidWebhookSignature(
  signature: string,
  url: string,
  params: Record<string, unknown>
): boolean {
  // NOTE: Twilio request signatures are computed with your account Auth Token,
  // not an API key secret. If you enable VALIDATE_TWILIO_REQUESTS, ensure the
  // secret used here matches the credential Twilio signs with.
  return twilio.validateRequest(config.twilio.apiKeySecret, signature, url, params);
}

/**
 * Place the outbound call to Party A. A sees the masked Twilio number as caller ID.
 */
export function createOutboundCall(options: {
  to: string;
  bridgeUrl: string;
  statusCallbackUrl: string;
}) {
  return client.calls.create({
    to: options.to,
    from: config.twilio.number, // A sees the masked number
    url: options.bridgeUrl, // run when A answers
    method: "POST",
    timeout: config.ringTimeout,
    statusCallback: options.statusCallbackUrl,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    ...(config.useMachineDetection ? { machineDetection: "Enable" } : {}),
  });
}

/**
 * Kick off post-call transcription of a dual-channel recording via Conversation
 * Intelligence. `customerKey` is echoed back to the completion webhook so we can
 * correlate the finished transcript with its session.
 */
export function createTranscript(options: {
  customerKey: string;
  recordingSid: string;
}) {
  return client.intelligence.v2.transcripts.create({
    serviceSid: config.twilio.intelligenceServiceSid,
    customerKey: options.customerKey,
    channel: {
      // Channel 1 = A (parent leg), Channel 2 = B (child leg).
      media_properties: { source_sid: options.recordingSid },
    },
  });
}

/**
 * Fetch the ordered sentences of a finished Conversation Intelligence transcript.
 */
export function listTranscriptSentences(transcriptSid: string) {
  return client.intelligence.v2.transcripts(transcriptSid).sentences.list();
}
