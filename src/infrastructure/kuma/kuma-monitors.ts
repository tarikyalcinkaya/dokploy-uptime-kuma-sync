import { z } from 'zod'
import type { Monitor, MonitorSpec } from '../../domain/monitor.js'
import type { Notification } from '../../domain/notification.js'
import type { IMonitorReader, IMonitorWriter, INotificationSource } from '../../domain/ports.js'
import { describeAckFailure, type KumaSession } from './kuma-session.js'

const kumaMonitorSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  url: z.string().nullable().optional(),
  active: z.union([z.boolean(), z.number()]),
  forceInactive: z.boolean().optional(),
  description: z.string().nullable().optional(),
})

const kumaNotificationSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  active: z.union([z.boolean(), z.number()]),
})

const monitorListSchema = z.record(z.string(), kumaMonitorSchema)

type KumaMonitor = z.infer<typeof kumaMonitorSchema>

// The 2.x `add` handler JSON-encodes these columns unconditionally; omitting them breaks NOT NULL.
const CREATE_DEFAULTS = {
  type: 'http',
  method: 'GET',
  accepted_statuscodes: ['200-299'],
  maxredirects: 10,
  expiryNotification: false,
  ignoreTls: false,
  upsideDown: false,
  resendInterval: 0,
  httpBodyEncoding: 'json',
  authMethod: null,
  parent: null,
  conditions: [],
  kafkaProducerBrokers: [],
  kafkaProducerSaslOptions: { mechanism: 'None' },
  rabbitmqNodes: [],
} as const

const managedFields = (spec: MonitorSpec): Record<string, unknown> => ({
  name: spec.name,
  url: spec.url,
  description: spec.description,
  interval: spec.settings.intervalSeconds,
  retryInterval: spec.settings.intervalSeconds,
  maxretries: spec.settings.retries,
  timeout: spec.settings.timeoutSeconds,
  notificationIDList: Object.fromEntries(spec.settings.notificationIds.map((id) => [id, true])),
})

const readMonitorList = async (session: KumaSession): Promise<Record<string, KumaMonitor>> =>
  monitorListSchema.parse(await session.pushed('monitorList'))

export class KumaMonitorReader implements IMonitorReader {
  readonly #session: KumaSession

  constructor(session: KumaSession) {
    this.#session = session
  }

  async listMonitors(): Promise<Monitor[]> {
    const list = await readMonitorList(this.#session)
    return Object.values(list).map((raw) => ({
      id: raw.id,
      name: raw.name,
      url: raw.url ?? null,
      // 2.x reports a child of a paused group as inactive; its own flag is then unknown, and
      // treating it as paused would resume it every cycle.
      isActive: Boolean(raw.active) || raw.forceInactive === true,
      description: raw.description ?? null,
    }))
  }
}

export class KumaMonitorWriter implements IMonitorWriter {
  readonly #session: KumaSession

  constructor(session: KumaSession) {
    this.#session = session
  }

  async createMonitor(spec: MonitorSpec): Promise<number> {
    const ack = await this.#session.call('add', {
      ...CREATE_DEFAULTS,
      ...managedFields(spec),
      active: true,
    })
    if (!ack?.ok || typeof ack.monitorID !== 'number') {
      throw new Error(describeAckFailure('add', ack))
    }
    return ack.monitorID
  }

  // `editMonitor` overwrites every column from the payload, so send Kuma's own copy back with only
  // our fields changed — exactly what its UI does. A partial payload would null out the rest.
  async updateMonitor(id: number, spec: MonitorSpec): Promise<void> {
    const current = (await readMonitorList(this.#session))[String(id)]
    if (!current) {
      throw new Error(`Kuma monitor ${id} disappeared before it could be updated`)
    }
    await this.#session.expectOk('editMonitor', { ...current, ...managedFields(spec), id })
  }

  async pauseMonitor(id: number): Promise<void> {
    await this.#session.expectOk('pauseMonitor', id)
  }

  async resumeMonitor(id: number): Promise<void> {
    await this.#session.expectOk('resumeMonitor', id)
  }

  async deleteMonitor(id: number): Promise<void> {
    await this.#session.expectOk('deleteMonitor', id, false)
  }
}

// Kuma's UI never shows notification ids, but it pushes them over the socket after login.
export class KumaNotificationSource implements INotificationSource {
  readonly #session: KumaSession

  constructor(session: KumaSession) {
    this.#session = session
  }

  async listNotifications(): Promise<Notification[]> {
    const list = z
      .array(kumaNotificationSchema)
      .parse(await this.#session.pushed('notificationList'))
    return list.map((raw) => ({ id: raw.id, name: raw.name, isActive: Boolean(raw.active) }))
  }
}
