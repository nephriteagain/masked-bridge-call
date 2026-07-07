import type { Request, Response } from "express";

import { sessionRepository } from "../repositories/index.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * GET /sessions/:id
 * Read back a session's status and post-call transcript. Real phone numbers are
 * deliberately NOT returned — they never leave the backend.
 */
export async function getSession(req: Request, res: Response): Promise<void> {
  const session = await sessionRepository.getSession(req.params.id);
  if (!session) throw new NotFoundError("Session not found");

  res.json({
    id: session.id,
    status: session.status,
    createdAt: session.createdAt,
    recordingSid: session.recordingSid,
    transcriptSid: session.transcriptSid,
    ciTranscript: session.ciTranscript, // post-call Conversation Intelligence result
  });
}
