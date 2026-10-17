import { z } from 'zod'
import type { Exclusions } from '../domain/exclusion.js'

type Env = Record<string, string | undefined>

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

const positiveInt = z.coerce.number().int().positive()

const logLevel = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info')

const logFormat = z.enum(['json', 'pretty']).default('json')

// `docker run --env-file` keeps quotes while Node's `--env-file` strips them; normalise so both work.
export const unquote = (value: string): string => {
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  return quoted ? value.slice(1, -1) : value
}

const normalise = (env: Env): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [key, unquote(value)]),
  )

const databaseUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message:
      'must start with postgres:// — note that `docker run --env-file` keeps quotes, so write it unquoted: DATABASE_URL=postgres://user:pass@dokploy-postgres:5432/dokploy',
  })

const commaList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )

const STATUS_CODE_RANGE = /^\d{3}(-\d{3})?$/

// `pattern=value` pairs, comma separated; the first pattern that matches a host wins.
const hostRules = <T>(parseValue: z.ZodType<T>) =>
  commaList.transform((pairs, context) =>
    pairs.flatMap((pair) => {
      const separator = pair.indexOf('=')
      const pattern = pair.slice(0, separator).trim()
      const value = parseValue.safeParse(pair.slice(separator + 1).trim())
      if (separator <= 0 || !value.success) {
        context.addIssue({ code: 'custom', message: `"${pair}" is not a valid host=value pair` })
        return []
      }
      return [{ pattern, value: value.data }]
    }),
  )

const healthPath = z.string().regex(/^\//, 'must start with /')

const statusCodes = z
  .string()
  .transform((value) => value.split('|').map((code) => code.trim()))
  .pipe(z.array(z.string().regex(STATUS_CODE_RANGE)).min(1))

// Enough to read Dokploy, so `pnpm domains` works before any Kuma credentials exist.
const databaseConfigSchema = z.object({
  DATABASE_URL: databaseUrl,
  GROUP_BY_PROJECT: boolish.default(true),
  HEALTH_PATHS: hostRules(healthPath),
  EXCLUDE_HOSTS: commaList,
  EXCLUDE_PROJECTS: commaList,
  EXCLUDE_SERVICES: commaList,
  EXCLUDE_MIDDLEWARES: commaList,
  LOG_LEVEL: logLevel,
  LOG_FORMAT: logFormat,
})

const kumaConfigSchema = z.object({
  KUMA_URL: z.url(),
  KUMA_USERNAME: z.string().min(1),
  KUMA_PASSWORD: z.string().min(1),
  KUMA_TOTP_SECRET: z.string().min(1).optional(),
  LOG_LEVEL: logLevel,
  LOG_FORMAT: logFormat,
})

const configSchema = databaseConfigSchema.extend(kumaConfigSchema.shape).extend({
  KUMA_PUSH_URL: z.url().optional(),
  KUMA_NOTIFICATION_IDS: commaList,
  DRY_RUN: boolish.default(true),
  RUN_MODE: z.enum(['once', 'loop']).default('once'),
  INTERVAL_SECONDS: positiveInt.default(900),
  ON_REMOVE: z.enum(['pause', 'delete']).default('pause'),
  ACCEPTED_STATUS_CODES: hostRules(statusCodes),
  MAX_RETIRE_RATIO: z.coerce.number().min(0).max(1).default(0.5),
  MONITOR_INTERVAL_SECONDS: positiveInt.default(60),
  MONITOR_RETRIES: z.coerce.number().int().min(0).default(2),
  MONITOR_TIMEOUT_SECONDS: positiveInt.default(16),
})

export type Config = z.infer<typeof configSchema>
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>
export type KumaConfig = z.infer<typeof kumaConfigSchema>

const parse = <T extends z.ZodType>(schema: T, env: Env): z.infer<T> => {
  const parsed = schema.safeParse(normalise(env))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid configuration:\n${issues}`)
  }
  return parsed.data
}

export const toExclusions = (config: DatabaseConfig): Exclusions => ({
  hosts: config.EXCLUDE_HOSTS,
  projects: config.EXCLUDE_PROJECTS,
  services: config.EXCLUDE_SERVICES,
  middlewares: config.EXCLUDE_MIDDLEWARES,
})

export const loadDatabaseConfig = (env: Env = process.env): DatabaseConfig =>
  parse(databaseConfigSchema, env)

export const loadKumaConfig = (env: Env = process.env): KumaConfig => parse(kumaConfigSchema, env)

export const loadConfig = (env: Env = process.env): Config => {
  const config = parse(configSchema, env)
  if (config.MONITOR_TIMEOUT_SECONDS >= config.MONITOR_INTERVAL_SECONDS) {
    throw new Error(
      'MONITOR_TIMEOUT_SECONDS must be lower than MONITOR_INTERVAL_SECONDS — Uptime Kuma rejects monitors otherwise',
    )
  }
  return config
}
