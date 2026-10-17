import pino from 'pino'

export type LogFormat = 'json' | 'pretty'

export const createLogger = (level: string, format: LogFormat = 'json') =>
  pino({
    level,
    // Never let a Kuma password or TOTP secret reach the log stream.
    redact: {
      paths: ['password', 'KUMA_PASSWORD', 'KUMA_TOTP_SECRET', 'DATABASE_URL', 'token'],
      censor: '[redacted]',
    },
    transport:
      format === 'pretty' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  })
