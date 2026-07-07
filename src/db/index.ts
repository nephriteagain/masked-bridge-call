import { Sequelize } from "sequelize";

import { logger } from "../utils/logger.js";

/**
 * Sequelize connection singleton and lifecycle helpers.
 *
 * The database file location is intentionally kept simple (SQLite on disk). For a
 * multi-instance production deployment, point `storage`/`dialect` at Postgres/MySQL
 * via config and introduce migrations instead of `sync({ alter: true })`.
 */
export const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: "./call-history.db",
  logging: false, // set to (msg) => logger.debug(msg) for SQL debugging
});

export async function initializeDatabase(): Promise<void> {
  try {
    await sequelize.authenticate();
    logger.info("Database connection established.");
    // NOTE: `alter: true` is convenient for development. In production, replace this
    // with a proper migration workflow (e.g. umzug / sequelize-cli).
    await sequelize.sync({ alter: true });
    logger.info("Database schema synced.");
  } catch (error) {
    logger.error("Failed to initialize database.", { error: (error as Error).message });
    process.exit(1);
  }
}

export async function closeDatabase(): Promise<void> {
  await sequelize.close();
}
