import { z } from 'zod'
import {
  DEFAULT_ACCEPTED_STATUS_CODES,
  type GroupSpec,
  type Monitor,
  type MonitorSpec,
} from '../../domain/monitor.js'
import type { Notification } from '../../domain/notification.js'
import type {
  IGroupWriter,
  IMonitorReader,
  IMonitorWriter,
  INotificationSource,
} from '../../domain/ports.js'
import { describeAckFailure, type KumaSession } from './kuma-session.js'

const kumaMonitorSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  url: z.string().nullable().optional(),
  parent: z.number().nullable().optional(),
  active: z.union([z.boolean(), z.number()]),
  forceInactive: z.boolean().optional(),
  description: z.string().nullable().optional(),
  // Lenient: one odd hand-made monitor must not fail a cycle that never touches it.
  interval: z.number().nullish(),
  maxretries: z.number().nullish(),
  timeout: z.number().nullish(),
  expiryNotification: z.boolean().nullish(),
  accepted_statuscodes: z.array(z.string()).nullish(),
  notificationIDList: z.record(z.string(), z.boolean()).nullish(),
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
  maxredirects: 10,
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
  parent: spec.parentId,
  accepted_statuscodes: spec.acceptedStatusCodes,
  interval: spec.settings.intervalSeconds,
  retryInterval: spec.settings.intervalSeconds,
  maxretries: spec.settings.retries,
  timeout: spec.settings.timeoutSeconds,
  expiryNotification: spec.settings.notifiesCertificateExpiry,
  notificationIDList: Object.fromEntries(spec.settings.notificationIds.map((id) => [id, true])),
})

// Groups never notify: a child going down already alerts, and the group would repeat it.
const groupFields = (spec: GroupSpec): Record<string, unknown> => ({
  name: spec.name,
  accepted_statuscodes: DEFAULT_ACCEPTED_STATUS_CODES,
  description: spec.description,
  interval: spec.intervalSeconds,
  retryInterval: spec.intervalSeconds,
  expiryNotification: false,
  notificationIDList: {},
})

const readMonitorList = async (session: KumaSession): Promise<Record<string, KumaMonitor>> =>
  monitorListSchema.parse(await session.pushed('monitorList'))

const addMonitor = async (
  session: KumaSession,
  payload: Record<string, unknown>,
): Promise<number> => {
  const ack = await session.call('add', { ...CREATE_DEFAULTS, ...payload, active: true })
  if (!ack?.ok || typeof ack.monitorID !== 'number') {
    throw new Error(describeAckFailure('add', ack))
  }
  return ack.monitorID
}

// `editMonitor` overwrites every column, so Kuma's own copy goes back with only our fields changed.
const editMonitor = async (
  session: KumaSession,
  id: number,
  fields: Record<string, unknown>,
): Promise<void> => {
  const current = (await readMonitorList(session))[String(id)]
  if (!current) {
    throw new Error(`Kuma monitor ${id} disappeared before it could be updated`)
  }
  await session.expectOk('editMonitor', { ...current, ...fields, id })
}

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
      isGroup: raw.type === 'group',
      parentId: raw.parent ?? null,
      // Under a paused group the child's own flag is hidden; reading it as paused would resume it.
      isActive: Boolean(raw.active) || raw.forceInactive === true,
      description: raw.description ?? null,
      acceptedStatusCodes: raw.accepted_statuscodes ?? [],
      settings: {
        intervalSeconds: raw.interval ?? 0,
        retries: raw.maxretries ?? 0,
        timeoutSeconds: raw.timeout ?? 0,
        notifiesCertificateExpiry: raw.expiryNotification ?? false,
        notificationIds: Object.entries(raw.notificationIDList ?? {})
          .filter(([, isOn]) => isOn)
          .map(([id]) => id),
      },
    }))
  }
}

export class KumaMonitorWriter implements IMonitorWriter {
  readonly #session: KumaSession

  constructor(session: KumaSession) {
    this.#session = session
  }

  createMonitor(spec: MonitorSpec): Promise<number> {
    return addMonitor(this.#session, managedFields(spec))
  }

  updateMonitor(id: number, spec: MonitorSpec): Promise<void> {
    return editMonitor(this.#session, id, managedFields(spec))
  }

  describeMonitor(id: number, description: string): Promise<void> {
    return editMonitor(this.#session, id, { description })
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

export class KumaGroupWriter implements IGroupWriter {
  readonly #session: KumaSession

  constructor(session: KumaSession) {
    this.#session = session
  }

  createGroup(spec: GroupSpec): Promise<number> {
    return addMonitor(this.#session, { ...groupFields(spec), type: 'group', url: null })
  }

  updateGroup(id: number, spec: GroupSpec): Promise<void> {
    return editMonitor(this.#session, id, groupFields(spec))
  }

  // Only ever called on an empty group, but `false` keeps a child added by hand from going with it.
  async deleteGroup(id: number): Promise<void> {
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
