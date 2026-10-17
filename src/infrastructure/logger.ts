import pino from 'pino'

export type LogFormat = 'json' | 'pretty'

export const createLogger = (level: string, format: LogFormat = 'json') =>
  pino({
    level,
    // Never let a Kuma password or TOTP secret reach the log stream.
    redact: {
      paths: [
        'password',
        'token',
        'jwt',
        'KUMA_PASSWORD',
        'KUMA_TOTP_SECRET',
        'KUMA_PUSH_URL',
        'DATABASE_URL',
        '*.password',
        '*.token',
        '*.jwt',
      ],
      censor: '[redacted]',
    },
    transport:
      format === 'pretty' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  })
