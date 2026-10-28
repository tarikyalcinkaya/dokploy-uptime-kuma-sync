import { createRequire } from 'node:module'
import pino from 'pino'

export type LogFormat = 'json' | 'pretty'

const hasPrettyTransport = (): boolean => {
  try {
    createRequire(import.meta.url).resolve('pino-pretty')
    return true
  } catch {
    return false
  }
}

export const createLogger = (level: string, format: LogFormat = 'json') => {
  const pretty = format === 'pretty' && hasPrettyTransport()
  const logger = pino({
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
    transport: pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  })
  if (format === 'pretty' && !pretty) {
    // pino-pretty is a devDependency, so the production image falls back to JSON instead of crashing.
    logger.warn('LOG_FORMAT=pretty needs pino-pretty, which is not installed; logging JSON')
  }
  return logger
}
