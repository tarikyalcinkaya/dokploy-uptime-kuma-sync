import { z } from 'zod'
import type { Exclusions } from '../domain/exclusion.js'
import { DEFAULT_ALIVE_FILE } from './liveness.js'

type Env = Record<string, string | undefined>

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

const positiveInt = z.coerce.number().int().positive()

// Kuma refuses monitor intervals below 20 seconds.
const monitorInterval = z.coerce.number().int().min(20)

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

// An empty `KEY=` line means unset; coerced, it would silently become 0 or false.
const normalise = (env: Env): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [key, unquote(value)])
      .filter(([, value]) => value !== ''),
  )

// The admin password crosses this URL, so plain http is only allowed where it never leaves the
// host or the Docker network: loopback, or a dotless container name such as `uptime-kuma`.
const kumaUrl = z.url().refine(
  (value) => {
    const url = new URL(value)
    const isPrivate = !url.hostname.includes('.') || ['127.0.0.1', '[::1]'].includes(url.hostname)
    return url.username === '' && (url.protocol === 'https:' || isPrivate)
  },
  {
    message:
      'must be https (http only for localhost or a Docker service name) and carry no credentials',
  },
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
  KUMA_URL: kumaUrl,
  KUMA_USERNAME: z.string().min(1),
  KUMA_PASSWORD: z.string().min(1),
  KUMA_TOTP_SECRET: z.string().min(1).optional(),
  LOG_LEVEL: logLevel,
  LOG_FORMAT: logFormat,
})

const livenessConfigSchema = z.object({
  RUN_MODE: z.enum(['once', 'loop']).default('once'),
  INTERVAL_SECONDS: positiveInt.default(900),
  ALIVE_FILE: z.string().min(1).default(DEFAULT_ALIVE_FILE),
})

const configSchema = databaseConfigSchema
  .extend(kumaConfigSchema.shape)
  .extend(livenessConfigSchema.shape)
  .extend({
    KUMA_PUSH_URL: kumaUrl.optional(),
    KUMA_NOTIFICATION_IDS: commaList.pipe(
      z.array(z.string().regex(/^\d+$/, 'must be numeric ids')),
    ),
    DRY_RUN: boolish.default(true),
    ON_REMOVE: z.enum(['pause', 'delete']).default('pause'),
    PAUSED_DELETE_AFTER_DAYS: z.coerce.number().int().min(0).default(30),
    ACCEPTED_STATUS_CODES: hostRules(statusCodes),
    MAX_RETIRE_RATIO: z.coerce.number().min(0).max(1).default(0.5),
    MONITOR_INTERVAL_SECONDS: monitorInterval.default(120),
    MONITOR_INTERVAL_SECONDS_OTHER_ENVS: monitorInterval.default(300),
    MONITOR_EXPIRY_NOTIFICATION: boolish.default(true),
    MONITOR_RETRIES: z.coerce.number().int().min(0).default(2),
    MONITOR_TIMEOUT_SECONDS: positiveInt.default(16),
  })

export type Config = z.infer<typeof configSchema>
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>
export type KumaConfig = z.infer<typeof kumaConfigSchema>
export type LivenessConfig = z.infer<typeof livenessConfigSchema>

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

export const loadLivenessConfig = (env: Env = process.env): LivenessConfig =>
  parse(livenessConfigSchema, env)

export const loadKumaConfig = (env: Env = process.env): KumaConfig => parse(kumaConfigSchema, env)

export const loadConfig = (env: Env = process.env): Config => {
  const config = parse(configSchema, env)
  const shortestInterval = Math.min(
    config.MONITOR_INTERVAL_SECONDS,
    config.MONITOR_INTERVAL_SECONDS_OTHER_ENVS,
  )
  if (config.MONITOR_TIMEOUT_SECONDS >= shortestInterval) {
    throw new Error(
      'MONITOR_TIMEOUT_SECONDS must be lower than both MONITOR_INTERVAL_SECONDS values — Uptime Kuma rejects monitors otherwise',
    )
  }
  return config
}
