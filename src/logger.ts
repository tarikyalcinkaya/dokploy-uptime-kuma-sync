import pino from "pino";

export const createLogger = (level: string) =>
  pino({
    level,
    // Never let a Kuma password or TOTP secret reach the log stream.
    redact: {
      paths: [
        "password",
        "KUMA_PASSWORD",
        "KUMA_TOTP_SECRET",
        "DATABASE_URL",
        "token",
      ],
      censor: "[redacted]",
    },
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } },
  });

export type Logger = ReturnType<typeof createLogger>;
