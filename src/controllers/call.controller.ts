import type { Request, Response } from "express";

import * as callService from "../services/call.service.js";

/**
 * POST /connect  { partyA, partyB }
 * Starts a Call Connect call: creates the session and places the outbound call to the
 * provider (A). partyA is the provider, partyB is the client; both numbers stay masked.
 */
export async function connect(req: Request, res: Response): Promise<void> {
  const { partyA, partyB } = (req.body || {}) as { partyA?: string; partyB?: string };
  const result = await callService.initiateConnection({ partyA, partyB });
  res.status(201).json(result);
}
