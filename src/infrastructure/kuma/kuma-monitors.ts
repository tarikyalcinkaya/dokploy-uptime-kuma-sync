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
  description: z.string().nullable().optional(),
})

const kumaNotificationSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  active: z.union([z.boolean(), z.number()]),
})

const MONITOR_DEFAULTS = {
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
} as const

const toPayload = (spec: MonitorSpec): Record<string, unknown> => ({
  ...MONITOR_DEFAULTS,
  name: spec.name,
  url: spec.url,
  interval: spec.settings.intervalSeconds,
  retryInterval: spec.settings.intervalSeconds,
  maxretries: spec.settings.retries,
  timeout: spec.settings.timeoutSeconds,
  description: spec.description,
  notificationIDList: Object.fromEntries(spec.settings.notificationIds.map((id) => [id, true])),
  active: true,
})

export class KumaMonitorReader implements IMonitorReader {
  readonly #session: KumaSession

  constructor(session: KumaSession) {
    this.#session = session
  }

  async listMonitors(): Promise<Monitor[]> {
    const list = z
      .record(z.string(), kumaMonitorSchema)
      .parse(await this.#session.pushed('monitorList'))
    return Object.values(list).map((raw) => ({
      id: raw.id,
      name: raw.name,
      url: raw.url ?? null,
      isActive: Boolean(raw.active),
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
    const ack = await this.#session.call('add', toPayload(spec))
    if (!ack?.ok || typeof ack.monitorID !== 'number') {
      throw new Error(describeAckFailure('add', ack))
    }
    return ack.monitorID
  }

  async updateMonitor(id: number, spec: MonitorSpec): Promise<void> {
    await this.#session.expectOk('editMonitor', { ...toPayload(spec), id })
  }

  async pauseMonitor(id: number): Promise<void> {
    await this.#session.expectOk('pauseMonitor', id)
  }

  async resumeMonitor(id: number): Promise<void> {
    await this.#session.expectOk('resumeMonitor', id)
  }

  async deleteMonitor(id: number): Promise<void> {
    await this.#session.expectOk('deleteMonitor', id)
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
