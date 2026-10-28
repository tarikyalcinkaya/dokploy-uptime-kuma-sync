import postgres from 'postgres'
import { io } from 'socket.io-client'
import type { ILogger } from '../application/logger.js'
import { KumaSession } from '../infrastructure/kuma/kuma-session.js'

export const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set — run integration tests through \`pnpm test:integration\``)
  }
  return value
}

export const kumaUrl = (): string => requireEnv('KUMA_IT_URL')

export const databaseUrl = (): string => requireEnv('PG_IT_URL')

export const KUMA_CREDENTIALS = { username: 'admin', password: 'integration-pass-1' }

// On connect Kuma announces `setup` (no user yet) or `loginRequired`; the first creates the admin.
const ensureAdmin = async (url: string): Promise<void> => {
  const socket = io(url, { transports: ['websocket'], reconnection: false, timeout: 10_000 })
  try {
    const needsSetup = await new Promise<boolean>((resolve, reject) => {
      socket.once('setup', () => resolve(true))
      socket.once('loginRequired', () => resolve(false))
      socket.once('connect_error', reject)
    })
    if (needsSetup) {
      await socket
        .timeout(10_000)
        .emitWithAck('setup', KUMA_CREDENTIALS.username, KUMA_CREDENTIALS.password)
    }
  } finally {
    socket.close()
  }
}

let cachedJwt: string | null = null

// One password login per test process; the rest reuse its JWT to stay clear of Kuma's login limit.
export const withKuma = async <T>(work: (session: KumaSession) => Promise<T>): Promise<T> => {
  const url = kumaUrl()
  if (!cachedJwt) {
    await ensureAdmin(url)
  }
  const session = new KumaSession(
    cachedJwt ? { url, jwt: cachedJwt } : { url, ...KUMA_CREDENTIALS },
    silentLogger,
  )
  await session.open()
  cachedJwt ??= session.jwt
  try {
    return await work(session)
  } finally {
    session.close()
  }
}

export const resetKuma = (): Promise<void> =>
  withKuma(async (session) => {
    const list = (await session.pushed('monitorList')) as Record<string, { id: number }>
    for (const { id } of Object.values(list)) {
      await session.call('deleteMonitor', id, true)
    }
  })

export const addWebhookNotification = (name: string): Promise<number> =>
  withKuma(async (session) => {
    const ack = (await session.expectOk(
      'addNotification',
      {
        name,
        type: 'webhook',
        webhookURL: 'http://127.0.0.1:9/never',
        webhookContentType: 'json',
        isDefault: false,
        applyExisting: false,
      },
      null,
    )) as { id?: number }
    if (typeof ack.id !== 'number') {
      throw new Error('Kuma did not return a notification id')
    }
    return ack.id
  })

export const withDatabase = async <T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> => {
  const sql = postgres(databaseUrl(), { max: 1, onnotice: () => undefined })
  try {
    return await work(sql)
  } finally {
    await sql.end()
  }
}

export interface SeedDomain {
  domainId: string
  host: string
  https?: boolean
  path?: string | null
  middlewares?: string[]
  previewDeploymentId?: string | null
}

export interface SeedService {
  projectId: string
  projectName: string
  environmentName?: string
  isDefaultEnvironment?: boolean
  kind: 'application' | 'compose'
  serviceId: string
  serviceName: string
  status?: 'idle' | 'running' | 'done' | 'error'
  domains: SeedDomain[]
}

export const seedDokploy = (services: SeedService[]): Promise<void> =>
  withDatabase(async (sql) => {
    await sql`TRUNCATE domain, application, compose, environment, project CASCADE`
    for (const [index, service] of services.entries()) {
      const environmentId = `${service.projectId}-env-${service.environmentName ?? 'production'}`
      await sql`INSERT INTO project ("projectId", name) VALUES (${service.projectId}, ${service.projectName})
        ON CONFLICT DO NOTHING`
      await sql`INSERT INTO environment ("environmentId", name, "projectId", "isDefault")
        VALUES (${environmentId}, ${service.environmentName ?? 'production'}, ${service.projectId},
          ${service.isDefaultEnvironment ?? true})
        ON CONFLICT DO NOTHING`
      const table = service.kind
      const idColumn = service.kind === 'application' ? 'applicationId' : 'composeId'
      const statusColumn = service.kind === 'application' ? 'applicationStatus' : 'composeStatus'
      await sql`INSERT INTO ${sql(table)} (${sql(idColumn)}, name, ${sql(statusColumn)}, "environmentId")
        VALUES (${service.serviceId}, ${service.serviceName}, ${service.status ?? 'done'}, ${environmentId})`
      for (const [domainIndex, domain] of service.domains.entries()) {
        await sql`INSERT INTO domain ("domainId", host, https, path, "domainType", "createdAt",
            ${sql(idColumn)}, "previewDeploymentId", middlewares)
          VALUES (${domain.domainId}, ${domain.host}, ${domain.https ?? true}, ${domain.path ?? '/'},
            ${service.kind}, ${`2026-01-01T00:${String(index).padStart(2, '0')}:${String(domainIndex).padStart(2, '0')}Z`},
            ${service.serviceId}, ${domain.previewDeploymentId ?? null}, ${domain.middlewares ?? []})`
      }
    }
  })
