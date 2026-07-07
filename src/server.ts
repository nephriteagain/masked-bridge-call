import type { Server } from "node:http";

import { config } from "./config/index.js";
import { createApp } from "./app.js";
import { initializeDatabase, closeDatabase } from "./db/index.js";
import "./models/index.js"; // ensure models + associations are registered before sync
import { logger } from "./utils/logger.js";

/**
 * Application entrypoint: initialize the database, start the HTTP server, and wire
 * up graceful shutdown.
 */
async function start(): Promise<void> {
  await initializeDatabase();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`Listening on http://localhost:${config.port}`, { env: config.env });
    logger.info(`Webhooks expect to be reachable at ${config.baseUrl}`);
    if (!config.validateTwilioRequests) {
      logger.warn("Twilio signature validation is OFF (set VALIDATE_TWILIO_REQUESTS=true for prod).");
    }
  });

  registerShutdownHandlers(server);
}

function registerShutdownHandlers(server: Server): void {
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully.`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  logger.error("Failed to start server.", { error: (err as Error).message });
  process.exit(1);
});
