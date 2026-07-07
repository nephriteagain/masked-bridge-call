import { Router } from "express";

import * as sessionController from "../controllers/session.controller.js";
import { asyncHandler } from "../middleware/async-handler.js";

/** Read-only access to session status and post-call transcripts. */
export const sessionRouter = Router();

sessionRouter.get("/sessions/:id", asyncHandler(sessionController.getSession));
