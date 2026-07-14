/**
 * Minimal structured logger.
 *
 * Emits single-line JSON so logs are machine-parseable in production (ingestible
 * by CloudWatch, Datadog, etc.) while remaining readable in development. Swap the
 * implementation for pino/winston here without touching call sites.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

/**
 * Formats a Date as a readable Philippine time string (Asia/Manila, UTC+8).
 * Example: "2026-07-14 23:54:45 PHT".
 */
function toPhTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} PHT`;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const now = new Date();
  const entry = {
    level,
    time: now.toISOString(),
    phTime: toPhTime(now),
    message,
    ...context,
  };
  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
