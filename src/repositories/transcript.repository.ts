import crypto from "node:crypto";

import { Transcript } from "../models/index.js";
import type { TranscriptStatus } from "../models/index.js";

/** Mutable attributes of a transcript. */
export type TranscriptUpdate = Partial<{
  status: TranscriptStatus;
  language: string;
  sentences: Record<string, unknown>[];
}>;

export function createTranscript(options: {
  sessionId: string;
  transcriptSid: string;
}): Promise<Transcript> {
  return Transcript.create({
    id: crypto.randomUUID(),
    sessionId: options.sessionId,
    transcriptSid: options.transcriptSid,
    status: "processing",
    sentences: [],
  });
}

export async function updateTranscript(
  transcriptSid: string,
  updates: TranscriptUpdate
): Promise<Transcript | null> {
  const transcript = await Transcript.findOne({ where: { transcriptSid } });
  if (!transcript) return null;
  return transcript.update(updates);
}
