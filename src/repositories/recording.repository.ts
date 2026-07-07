import crypto from "node:crypto";

import { Recording } from "../models/index.js";
import type { RecordingStatus } from "../models/index.js";

/** Mutable attributes of a recording. */
export type RecordingUpdate = Partial<{
  duration: number | null;
  channels: number;
  status: RecordingStatus;
  url: string | null;
}>;

export function createRecording(options: {
  sessionId: string;
  recordingSid: string;
}): Promise<Recording> {
  return Recording.create({
    id: crypto.randomUUID(),
    sessionId: options.sessionId,
    recordingSid: options.recordingSid,
    channels: 2,
    status: "queued",
  });
}

export async function updateRecording(
  recordingSid: string,
  updates: RecordingUpdate
): Promise<Recording | null> {
  const recording = await Recording.findOne({ where: { recordingSid } });
  if (!recording) return null;
  return recording.update(updates);
}
