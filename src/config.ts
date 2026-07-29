import { z } from "zod";

const boolish = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const positiveInt = z.coerce.number().int().positive();

const logLevel = z
  .enum(["trace", "debug", "info", "warn", "error", "fatal"])
  .default("info");

/** Just enough to read Dokploy, so `npm run domains` works before any Kuma credentials exist. */
const databaseConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: logLevel,
});

const configSchema = z.object({
  /** Dokploy's Postgres. A read-only role is strongly recommended. */
  DATABASE_URL: z.string().min(1),

  KUMA_URL: z.string().url(),
  KUMA_USERNAME: z.string().min(1),
  KUMA_PASSWORD: z.string().min(1),
  /** Base32 TOTP secret, only if 2FA is enabled on the Kuma account. */
  KUMA_TOTP_SECRET: z.string().min(1).optional(),

  /**
   * Push URL of a Kuma push monitor, so Kuma alerts when kuma-sync itself stops running.
   * Without it the sync is the blind spot in your alerting.
   */
  KUMA_PUSH_URL: z.string().url().optional(),

  /** Comma separated Kuma notification ids to attach to every managed monitor. */
  KUMA_NOTIFICATION_IDS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),

  /** Log the planned changes without touching Kuma. Defaults to on. */
  DRY_RUN: boolish.default("true"),

  RUN_MODE: z.enum(["once", "loop"]).default("once"),
  INTERVAL_SECONDS: positiveInt.default(900),

  /** What to do when a domain disappears from Dokploy. */
  ON_REMOVE: z.enum(["pause", "delete"]).default("pause"),

  /**
   * Refuse to retire more than this fraction of the managed monitors in one run.
   * Guards against a partial database read wiping the whole monitor set.
   */
  MAX_RETIRE_RATIO: z.coerce.number().min(0).max(1).default(0.5),

  MONITOR_INTERVAL_SECONDS: positiveInt.default(60),
  MONITOR_RETRIES: z.coerce.number().int().min(0).default(2),
  MONITOR_TIMEOUT_SECONDS: positiveInt.default(16),

  LOG_LEVEL: logLevel,
});

export type Config = z.infer<typeof configSchema>;
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

const describeFailure = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

export const loadDatabaseConfig = (): DatabaseConfig => {
  const parsed = databaseConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${describeFailure(parsed.error)}`);
  }
  return parsed.data;
};

export const loadConfig = (): Config => {
  const parsed = configSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${describeFailure(parsed.error)}`);
  }

  if (
    parsed.data.MONITOR_TIMEOUT_SECONDS >= parsed.data.MONITOR_INTERVAL_SECONDS
  ) {
    throw new Error(
      "MONITOR_TIMEOUT_SECONDS must be lower than MONITOR_INTERVAL_SECONDS — Uptime Kuma rejects monitors otherwise",
    );
  }

  return parsed.data;
};
