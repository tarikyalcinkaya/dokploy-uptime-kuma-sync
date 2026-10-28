import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Monitor } from '../domain/monitor.js'
import type { Notification } from '../domain/notification.js'
import { describeGroupOwnership, describeOwnership } from '../domain/ownership.js'
import { inspectKuma } from './inspect-kuma.js'

const monitor = (id: number, description: string | null): Monitor => ({
  id,
  name: `m${id}`,
  url: 'https://example.com',
  isGroup: false,
  parentId: null,
  isActive: true,
  description,
  acceptedStatusCodes: ['200-299'],
  settings: {
    intervalSeconds: 60,
    retries: 0,
    timeoutSeconds: 48,
    notificationIds: [],
    notifiesCertificateExpiry: false,
  },
})

describe('inspectKuma', () => {
  it('counts every monitor but lists only the managed ones', async () => {
    const owned = monitor(1, describeOwnership('d1'))
    const group = monitor(2, describeGroupOwnership('p1'))
    const manual = monitor(3, 'created by hand')
    const bare = monitor(4, null)
    const notifications: Notification[] = [{ id: 7, name: 'Telegram', isActive: true }]

    const inventory = await inspectKuma(
      { listMonitors: async () => [owned, manual, group, bare] },
      { listNotifications: async () => notifications },
    )

    assert.equal(inventory.monitorCount, 4)
    assert.deepEqual(
      inventory.managedMonitors,
      [owned, group].map(({ id, name, url, isActive }) => ({ id, name, url, isActive })),
    )
    assert.deepEqual(inventory.notifications, notifications)
  })

  it('reports an empty Kuma', async () => {
    const inventory = await inspectKuma(
      { listMonitors: async () => [] },
      { listNotifications: async () => [] },
    )
    assert.deepEqual(inventory, { notifications: [], monitorCount: 0, managedMonitors: [] })
  })

  it('propagates a failing reader instead of reporting a partial inventory', async () => {
    await assert.rejects(
      inspectKuma(
        {
          listMonitors: async () => {
            throw new Error('kuma down')
          },
        },
        { listNotifications: async () => [] },
      ),
      /kuma down/,
    )
  })
})
