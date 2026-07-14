import { Router } from "express";

import * as notificationController from "../controllers/notification.controller.js";
import { asyncHandler } from "../middleware/async-handler.js";

/** In-app provider notifications (e.g. "transcript ready"). */
export const notificationRouter = Router();

notificationRouter.get("/notifications", asyncHandler(notificationController.list));
notificationRouter.post("/notifications/:id/read", asyncHandler(notificationController.markRead));
