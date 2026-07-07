import type { NextFunction, Request, Response } from "express";

import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/** 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
}

/**
 * Central error handler. Translates thrown AppErrors into their status codes and
 * treats anything else as an unexpected 500. Must be registered last.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error handlers by arity.
  _next: NextFunction
): void {
  // Some webhooks ack (204) before doing async work; if that work fails we can only log.
  if (res.headersSent) {
    logger.error("Error after response sent.", { path: req.originalUrl, error: (err as Error).message });
    return;
  }

  if (err instanceof AppError) {
    logger.warn("Request failed.", { path: req.originalUrl, status: err.statusCode, message: err.message });
    res.status(err.statusCode).json({ error: err.message, ...(err.details ? { detail: err.details } : {}) });
    return;
  }

  logger.error("Unhandled error.", { path: req.originalUrl, error: (err as Error).message });
  res.status(500).json({ error: "Internal server error" });
}
