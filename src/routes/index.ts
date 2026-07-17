import { Router } from "express";

import { healthRouter } from "./health.routes.js";
import { callRouter } from "./call.routes.js";
import { sessionRouter } from "./session.routes.js";
import { transcriptRouter } from "./transcript.routes.js";
import { notificationRouter } from "./notification.routes.js";
import { webhookRouter } from "./webhook.routes.js";

/**
 * Root router. Public API routes live at the top level; Twilio webhooks are
 * namespaced under /webhooks.
 */
export const router = Router();

router.use(healthRouter);
router.use(callRouter);
router.use(sessionRouter);
router.use(transcriptRouter);
router.use(notificationRouter);
router.use("/webhooks", webhookRouter);
