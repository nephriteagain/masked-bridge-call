import { Router } from "express";

import * as webhookController from "../controllers/webhook.controller.js";
import { verifyTwilioSignature } from "../middleware/twilio-signature.middleware.js";
import { asyncHandler } from "../middleware/async-handler.js";

/**
 * Twilio-facing webhooks. All are signature-verified (when enabled) and mounted
 * under /webhooks. Configure the Conversation Intelligence Service's webhook URL to
 * <BASE_URL>/webhooks/intelligence.
 */
export const webhookRouter = Router();

webhookRouter.use(verifyTwilioSignature);

webhookRouter.post("/bridge", asyncHandler(webhookController.bridge));
webhookRouter.post("/dial-status", asyncHandler(webhookController.dialStatus));
webhookRouter.post("/call-status", asyncHandler(webhookController.callStatus));
webhookRouter.post("/recording", asyncHandler(webhookController.recording));
webhookRouter.post("/intelligence", asyncHandler(webhookController.intelligence));
