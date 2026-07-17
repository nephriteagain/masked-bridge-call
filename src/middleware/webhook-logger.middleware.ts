import type { NextFunction, Request, Response } from "express";

import { logger } from "../utils/logger.js";

/**
 * Log every inbound Twilio webhook — before signature verification, so we also
 * capture requests that get rejected — and log the response status once the
 * request finishes, so failures (4xx/5xx) are recorded regardless of outcome.
 *
 * Twilio sends form-encoded bodies; we surface the fields we care about instead
 * of the whole payload to keep log lines readable.
 */
export function logWebhookEvent(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  const body = (req.body ?? {}) as Record<string, unknown>;

  logger.info("Twilio webhook received", {
    path: req.originalUrl,
    method: req.method,
    sessionId: req.query.sessionId,
    // Common status/lifecycle fields across the various Twilio webhooks.
    callSid: body.CallSid ?? body.DialCallSid,
    callStatus: body.CallStatus ?? body.DialCallStatus,
    answeredBy: body.AnsweredBy,
    recordingSid: body.RecordingSid,
    transcriptSid: body.transcript_sid ?? body.TranscriptSid,
    customerKey: body.customer_key ?? body.CustomerKey,
    hasSignature: Boolean(req.header("X-Twilio-Signature")),
  });

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const context = {
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
    };
    if (res.statusCode >= 500) {
      logger.error("Twilio webhook errored", context);
    } else if (res.statusCode >= 400) {
      logger.warn("Twilio webhook rejected", context);
    } else {
      logger.info("Twilio webhook handled", context);
    }
  });

  next();
}
