import type { NextFunction, Request, Response } from "express";

import { config } from "../config/index.js";
import { isValidWebhookSignature } from "../services/twilio.service.js";
import { logger } from "../utils/logger.js";

/**
 * Verify each webhook is genuinely from Twilio. Applied only to the webhook routes
 * Twilio calls — not to your own /connect route. Controlled by VALIDATE_TWILIO_REQUESTS;
 * requires BASE_URL to exactly match the public URL Twilio hits.
 */
export function verifyTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  if (!config.validateTwilioRequests) return next();

  const signature = req.header("X-Twilio-Signature") || "";
  const url = config.baseUrl + req.originalUrl;

  if (!isValidWebhookSignature(signature, url, req.body)) {
    logger.warn("Rejected request with invalid Twilio signature.", { path: req.originalUrl });
    res.status(403).send("Invalid signature");
    return;
  }
  next();
}
