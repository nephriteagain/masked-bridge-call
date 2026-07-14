import crypto from "node:crypto";

import { Event } from "../models/index.js";
import type { EventParty } from "../models/index.js";

/**
 * Append-only activity log. `recordEvent` is called from the call/transcript
 * services at every meaningful transition; `listBySession` powers the timestamped
 * event-log view.
 */
export function recordEvent(options: {
  sessionId: string;
  type: string;
  party?: EventParty | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<Event> {
  return Event.create({
    id: crypto.randomUUID(),
    sessionId: options.sessionId,
    type: options.type,
    party: options.party ?? null,
    message: options.message ?? null,
    metadata: options.metadata ?? {},
  });
}

export function listBySession(sessionId: string): Promise<Event[]> {
  return Event.findAll({
    where: { sessionId },
    order: [
      ["createdAt", "ASC"],
      ["id", "ASC"],
    ],
  });
}
