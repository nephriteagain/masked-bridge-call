import crypto from "node:crypto";

import { Call } from "../models/index.js";
import type { CallLeg, CallStatus } from "../models/index.js";

/** Mutable attributes of a call leg. */
export type CallUpdate = Partial<{
  status: CallStatus;
  answeredBy: string | null;
}>;

export function createCall(options: {
  sessionId: string;
  callSid: string;
  leg: CallLeg;
  partyNumber: string;
  direction: "inbound" | "outbound";
  status?: CallStatus;
}): Promise<Call> {
  return Call.create({
    id: crypto.randomUUID(),
    sessionId: options.sessionId,
    callSid: options.callSid,
    leg: options.leg,
    partyNumber: options.partyNumber,
    status: options.status ?? "queued",
    direction: options.direction,
  });
}

export async function updateCall(
  callSid: string,
  updates: CallUpdate
): Promise<Call | null> {
  const call = await Call.findOne({ where: { callSid } });
  if (!call) return null;
  return call.update(updates);
}

/**
 * Create the call leg if we haven't seen this callSid yet, otherwise update it.
 * Status webhooks can arrive out of order and may precede the row's creation, so
 * lifecycle handlers upsert rather than assuming the leg already exists.
 */
export async function upsertCall(options: {
  sessionId: string;
  callSid: string;
  leg: CallLeg;
  partyNumber: string;
  direction: "inbound" | "outbound";
  status: CallStatus;
  answeredBy?: string | null;
}): Promise<Call> {
  const existing = await Call.findOne({ where: { callSid: options.callSid } });
  if (existing) {
    return existing.update({
      status: options.status,
      ...(options.answeredBy !== undefined ? { answeredBy: options.answeredBy } : {}),
    });
  }
  return Call.create({
    id: crypto.randomUUID(),
    sessionId: options.sessionId,
    callSid: options.callSid,
    leg: options.leg,
    partyNumber: options.partyNumber,
    status: options.status,
    direction: options.direction,
    answeredBy: options.answeredBy ?? null,
  });
}
