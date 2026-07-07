import "dotenv/config";

import { logger } from "../utils/logger.js";

/**
 * Centralized, validated application configuration.
 *
 * All access to `process.env` happens here so the rest of the codebase depends
 * on a single, strongly-typed config object. Required variables are validated at
 * startup; if any are missing the process exits with a clear message.
 */

interface AppConfig {
  readonly env: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly ringTimeout: number;
  readonly validateTwilioRequests: boolean;
  readonly useMachineDetection: boolean;
  readonly twilio: {
    readonly accountSid: string;
    readonly apiKeySid: string;
    readonly apiKeySecret: string;
    readonly number: string;
    /** Conversation Intelligence Service SID (GAxxxx). Empty string disables auto-transcription. */
    readonly intelligenceServiceSid: string;
  };
}

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_NUMBER",
  "BASE_URL",
] as const;

function loadConfig(): AppConfig {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error(
      `Missing required env var(s): ${missing.join(", ")}. Copy .env.example to .env and fill it in.`
    );
    process.exit(1);
  }

  const {
    NODE_ENV = "development",
    TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET,
    TWILIO_NUMBER,
    BASE_URL,
    PORT = "3000",
    RING_TIMEOUT = "20",
    VALIDATE_TWILIO_REQUESTS = "false",
    USE_MACHINE_DETECTION = "false",
    INTELLIGENCE_SERVICE_SID = "",
  } = process.env;

  return Object.freeze({
    env: NODE_ENV,
    port: Number(PORT),
    baseUrl: BASE_URL as string,
    ringTimeout: Number(RING_TIMEOUT),
    validateTwilioRequests: VALIDATE_TWILIO_REQUESTS === "true",
    useMachineDetection: USE_MACHINE_DETECTION === "true",
    twilio: Object.freeze({
      accountSid: TWILIO_ACCOUNT_SID as string,
      apiKeySid: TWILIO_API_KEY_SID as string,
      apiKeySecret: TWILIO_API_KEY_SECRET as string,
      number: TWILIO_NUMBER as string,
      intelligenceServiceSid: INTELLIGENCE_SERVICE_SID.trim(),
    }),
  });
}

export const config = loadConfig();
