import crypto from "node:crypto";

import { Notification } from "../models/index.js";
import type { NotificationType } from "../models/index.js";

/**
 * In-app notifications for the provider. Created out-of-band (e.g. when a transcript
 * finishes) and polled by the UI. `markRead` clears the unread badge.
 */
export function createNotification(options: {
  sessionId: string;
  type: NotificationType;
  title: string;
  body: string;
}): Promise<Notification> {
  return Notification.create({
    id: crypto.randomUUID(),
    sessionId: options.sessionId,
    type: options.type,
    title: options.title,
    body: options.body,
    read: false,
  });
}

export function listNotifications(options?: {
  unreadOnly?: boolean;
}): Promise<Notification[]> {
  return Notification.findAll({
    where: options?.unreadOnly ? { read: false } : {},
    order: [["createdAt", "DESC"]],
  });
}

export async function markRead(id: string): Promise<Notification | null> {
  const notification = await Notification.findByPk(id);
  if (!notification) return null;
  return notification.update({ read: true });
}
