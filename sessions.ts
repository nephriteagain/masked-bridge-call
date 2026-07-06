/**
 * In-memory session store.
 *
 * A "session" is one pairing: party A <-> party B. It holds the two REAL
 * phone numbers and the collected transcript. Crucially, the two real numbers
 * live ONLY here in your backend -- they are never sent to the other party and
 * never put in a caller ID. That is what makes the masking work.
 *
 * This Map is process-memory only: it is wiped on restart and does not work
 * across multiple server instances. For production, replace the get/create/
 * update/delete bodies with Redis, Postgres, DynamoDB, etc. The interface can
 * stay the same.
 */

import crypto from "node:crypto";

export type SessionStatus =
  | "initiated"
  | "ringing-a"
  | "bridging"
  | "completed"
  | "failed";

export interface CiTranscriptLine {
  speaker: "A" | "B";
  text: string;
  confidence: number | null;
}

export interface Session {
  id: string;
  partyA: string; // real number of A  (never exposed to B)
  partyB: string; // real number of B  (never exposed to A)
  status: SessionStatus;
  callSid: string | null;
  recordingSid: string | null; // dual-channel recording of the bridge
  transcriptSid: string | null; // Conversation Intelligence transcript (GTxxxx)
  ciTranscript: CiTranscriptLine[]; // post-call, speaker-labeled
  createdAt: string;
}

const sessions = new Map<string, Session>();

export function createSession({
  partyA,
  partyB,
}: {
  partyA: string;
  partyB: string;
}): Session {
  const id = crypto.randomUUID();
  const session: Session = {
    id,
    partyA, // real number of A  (never exposed to B)
    partyB, // real number of B  (never exposed to A)
    status: "initiated", // initiated | ringing-a | bridging | completed | failed
    callSid: null,
    recordingSid: null, // dual-channel recording of the bridge
    transcriptSid: null, // Conversation Intelligence transcript (GTxxxx)
    ciTranscript: [], // [{ speaker, text, confidence }] post-call, speaker-labeled
    createdAt: new Date().toISOString(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): Session | null {
  return sessions.get(id) || null;
}

export function updateSession(
  id: string,
  patch: Partial<Session>
): Session | null {
  const s = sessions.get(id);
  if (!s) return null;
  Object.assign(s, patch);
  return s;
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}
