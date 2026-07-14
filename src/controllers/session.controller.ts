import type { Request, Response } from "express";

import { sessionRepository, eventRepository } from "../repositories/index.js";
import * as callService from "../services/call.service.js";
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
    connectedAt: session.connectedAt,
    endedAt: session.endedAt,
    endReason: session.endReason,
    recordingSid: session.recordingSid,
    transcriptSid: session.transcriptSid,
    ciTranscript: session.ciTranscript, // post-call Conversation Intelligence result
  });
}

/** GET /sessions/:id/status — live phase, per-party state, and call timer. */
export async function status(req: Request, res: Response): Promise<void> {
  res.json(await callService.getLiveStatus(req.params.id));
}

/** GET /sessions/:id/summary — end-of-call summary confirming documentation. */
export async function summary(req: Request, res: Response): Promise<void> {
  res.json(await callService.getSummary(req.params.id));
}

/** GET /sessions/:id/events — timestamped activity log for the session. */
export async function events(req: Request, res: Response): Promise<void> {
  const session = await sessionRepository.getSession(req.params.id);
  if (!session) throw new NotFoundError("Session not found");

  const rows = await eventRepository.listBySession(req.params.id);
  res.json(
    rows.map((e) => ({
      id: e.id,
      type: e.type,
      party: e.party,
      message: e.message,
      metadata: e.metadata,
      at: e.createdAt,
    }))
  );
}

/**
 * POST /sessions/:id/cancel  { confirm: true }
 * Cancel a connecting call or leave an in-progress one (to rejoin video). The
 * confirmation flag is the API equivalent of the "are you sure?" step.
 */
export async function cancel(req: Request, res: Response): Promise<void> {
  const { confirm } = (req.body || {}) as { confirm?: boolean };
  const result = await callService.cancelCall(req.params.id, confirm === true);
  res.json(result);
}
