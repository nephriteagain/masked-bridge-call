import { Router } from "express";

import * as callController from "../controllers/call.controller.js";
import { asyncHandler } from "../middleware/async-handler.js";

/** Your application's API: start a masked connection between two numbers. */
export const callRouter = Router();

callRouter.post("/connect", asyncHandler(callController.connect));
