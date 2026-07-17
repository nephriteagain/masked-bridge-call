import { Router } from "express";

import * as transcriptController from "../controllers/transcript.controller.js";
import { asyncHandler } from "../middleware/async-handler.js";

/** Inspect Conversation Intelligence transcripts directly from Twilio. */
export const transcriptRouter = Router();

transcriptRouter.get("/transcripts/:sid", asyncHandler(transcriptController.getTranscript));
