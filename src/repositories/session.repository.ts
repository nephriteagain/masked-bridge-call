import crypto from "node:crypto";

import { Session } from "../models/index.js";
import type { SessionStatus, CiTranscriptLine } from "../models/index.js";

/** Mutable attributes of a session (excludes id, timestamps, and model methods). */
export type SessionUpdate = Partial<{
  status: SessionStatus;
  callSid: string | null;
  recordingSid: string | null;
  transcriptSid: string | null;
  ciTranscript: CiTranscriptLine[];
}>;

const RELATED = [
  { association: "calls", required: false },
  { association: "recording", required: false },
  { association: "transcript", required: false },
];

export function createSession(options: {
  partyA: string;
  partyB: string;
}): Promise<Session> {
  return Session.create({
    id: crypto.randomUUID(),
    partyA: options.partyA,
    partyB: options.partyB,
    status: "initiated",
    callSid: null,
    recordingSid: null,
    transcriptSid: null,
    ciTranscript: [],
  });
}

export function getSession(id: string): Promise<Session | null> {
  return Session.findByPk(id, { include: RELATED });
}

export async function updateSession(
  id: string,
  updates: SessionUpdate
): Promise<Session | null> {
  const session = await Session.findByPk(id);
  if (!session) return null;
  return session.update(updates);
}

export async function deleteSession(id: string): Promise<void> {
  await Session.destroy({ where: { id } });
}

export function listSessions(options?: {
  limit?: number;
  offset?: number;
  status?: SessionStatus;
}): Promise<{ rows: Session[]; count: number }> {
  return Session.findAndCountAll({
    where: options?.status ? { status: options.status } : {},
    limit: options?.limit,
    offset: options?.offset,
    include: RELATED,
    order: [["createdAt", "DESC"]],
  });
}
