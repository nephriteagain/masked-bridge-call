import type { Request, Response } from "express";

import * as callService from "../services/call.service.js";

/**
 * POST /connect  { partyA, partyB }
 * Starts a connection between two real numbers. Places the outbound call to A.
 * A sees TWILIO_NUMBER, not B.
 */
export async function connect(req: Request, res: Response): Promise<void> {
  const { partyA, partyB } = (req.body || {}) as { partyA?: string; partyB?: string };
  const result = await callService.initiateConnection({ partyA, partyB });
  res.json(result);
}
