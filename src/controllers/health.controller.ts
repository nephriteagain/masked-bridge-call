import type { Request, Response } from "express";

/** GET /  and  GET /health — liveness check. */
export function health(_req: Request, res: Response): void {
  res.json({ status: "ok", service: "call-connect" });
}
