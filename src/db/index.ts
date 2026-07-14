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
    logger.info("Initializing SQLite database...", { file: "./call-history.db" });
    await sequelize.authenticate();
    logger.info("✓ Database connection established.", { dialect: "sqlite", storage: "./call-history.db" });
    // NOTE: `alter: true` is unreliable on SQLite — it rebuilds tables via a
    // copy-into-backup dance that breaks on ENUM columns and FK relationships, and
    // any interruption leaves an orphaned `*_backup` table that wedges every
    // subsequent boot. Use plain `sync()` (create-if-missing) in dev and delete
    // `call-history.db` after a model change. For real schema evolution, adopt a
    // migration workflow (e.g. umzug / sequelize-cli).
    await sequelize.sync();
    logger.info("✓ Database schema synced.");
  } catch (error) {
    logger.error("Failed to initialize database.", { error });
    process.exit(1);
  }
}

export async function closeDatabase(): Promise<void> {
  await sequelize.close();
}
