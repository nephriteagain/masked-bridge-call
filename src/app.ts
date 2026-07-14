import express, { type Express } from "express";

import { router } from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.middleware.js";

/**
 * Builds and configures the Express application. Kept separate from server startup
 * so it can be imported by tests without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // Twilio posts webhooks as application/x-www-form-urlencoded.
  app.use(express.urlencoded({ extended: false }));
  // We also accept JSON on the /connect endpoint that YOUR app calls.
  app.use(express.json());
  // Skip the ngrok browser warning interstitial during local development.
  app.use((_req, res, next) => {
    res.setHeader("ngrok-skip-browser-warning", "true");
    next();
  });

  // Provider test UI (single static page). Served at "/", so it takes precedence
  // over the JSON liveness route; use GET /health for the liveness check.
  app.use(express.static("public"));

  app.use(router);

  // 404 + centralized error handling. Must be registered last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
