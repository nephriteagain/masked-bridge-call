import type { Request, Response } from "express";

import { notificationRepository } from "../repositories/index.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * In-app notifications for the provider (e.g. "transcript ready"). The UI polls
 * `GET /notifications?unread=true` for a badge and marks them read once seen.
 */
export async function list(req: Request, res: Response): Promise<void> {
  const unreadOnly = req.query.unread === "true";
  const rows = await notificationRepository.listNotifications({ unreadOnly });
  res.json(
    rows.map((n) => ({
      id: n.id,
      sessionId: n.sessionId,
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.read,
      at: n.createdAt,
    }))
  );
}

export async function markRead(req: Request, res: Response): Promise<void> {
  const updated = await notificationRepository.markRead(req.params.id);
  if (!updated) throw new NotFoundError("Notification not found");
  res.json({ id: updated.id, read: updated.read });
}
