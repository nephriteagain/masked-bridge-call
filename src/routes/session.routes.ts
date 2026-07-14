import { Router } from "express";

import * as sessionController from "../controllers/session.controller.js";
import { asyncHandler } from "../middleware/async-handler.js";

/** Session status, control (cancel), and post-call transcripts/summary. */
export const sessionRouter = Router();

sessionRouter.get("/sessions/:id", asyncHandler(sessionController.getSession));
sessionRouter.get("/sessions/:id/status", asyncHandler(sessionController.status));
sessionRouter.get("/sessions/:id/summary", asyncHandler(sessionController.summary));
sessionRouter.get("/sessions/:id/events", asyncHandler(sessionController.events));
sessionRouter.post("/sessions/:id/cancel", asyncHandler(sessionController.cancel));
