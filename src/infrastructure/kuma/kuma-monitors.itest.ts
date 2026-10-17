import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { MonitorSpec } from '../../domain/monitor.js'
import { describeOwnership } from '../../domain/ownership.js'
import { addWebhookNotification, resetKuma, withKuma } from '../../testing/fixtures.js'
import { KumaMonitorReader, KumaMonitorWriter, KumaNotificationSource } from './kuma-monitors.js'

const spec = (overrides: Partial<MonitorSpec> = {}): MonitorSpec => ({
  name: 'proj/api · app.example.com',
  url: 'https://app.example.com',
  description: describeOwnership('dom1'),
  settings: { intervalSeconds: 60, retries: 2, timeoutSeconds: 16, notificationIds: [] },
  ...overrides,
})

const create = (value: MonitorSpec = spec()): Promise<number> =>
  withKuma((session) => new KumaMonitorWriter(session).createMonitor(value))

const list = () => withKuma((session) => new KumaMonitorReader(session).listMonitors())

const raw = (id: number) =>
  withKuma(async (session) => {
    const monitors = (await session.pushed('monitorList')) as Record<
      string,
      Record<string, unknown>
    >
    return monitors[String(id)]
  })

describe('Kuma monitor adapters against a real Kuma 2.x', () => {
  beforeEach(resetKuma)

  it('creates a monitor that a fresh session reads back', async () => {
    const id = await create()
    assert.deepEqual(await list(), [
      {
        id,
        name: 'proj/api · app.example.com',
        url: 'https://app.example.com',
        isActive: true,
        description: describeOwnership('dom1'),
      },
    ])
  })

  it('updates our fields and keeps the ones a human set in Kuma', async () => {
    const id = await create()
    await withKuma(async (session) => {
      const current = (await raw(id)) ?? {}
      await session.expectOk('editMonitor', { ...current, headers: '{"X-Probe":"1"}', id })
    })

    await withKuma((session) =>
      new KumaMonitorWriter(session).updateMonitor(
        id,
        spec({ name: 'proj/api · new.example.com', url: 'https://new.example.com' }),
      ),
    )

    const after = await raw(id)
    assert.equal(after?.url, 'https://new.example.com')
    assert.equal(after?.name, 'proj/api · new.example.com')
    assert.equal(after?.headers, '{"X-Probe":"1"}')
  })

  it('pauses and resumes', async () => {
    const id = await create()
    await withKuma((session) => new KumaMonitorWriter(session).pauseMonitor(id))
    assert.equal((await list())[0]?.isActive, false)
    await withKuma((session) => new KumaMonitorWriter(session).resumeMonitor(id))
    assert.equal((await list())[0]?.isActive, true)
  })

  it('deletes', async () => {
    const id = await create()
    await withKuma((session) => new KumaMonitorWriter(session).deleteMonitor(id))
    assert.deepEqual(await list(), [])
  })

  it('attaches the configured notifications and lists them for inspect', async () => {
    const notificationId = await addWebhookNotification('integration')
    const id = await create(
      spec({
        settings: {
          intervalSeconds: 60,
          retries: 2,
          timeoutSeconds: 16,
          notificationIds: [String(notificationId)],
        },
      }),
    )

    assert.deepEqual((await raw(id))?.notificationIDList, { [notificationId]: true })
    const notifications = await withKuma((session) =>
      new KumaNotificationSource(session).listNotifications(),
    )
    assert.ok(notifications.some((n) => n.id === notificationId && n.name === 'integration'))
  })
})
