import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { PostgresDomainSource } from '../infrastructure/dokploy/postgres-domain-source.js'
import {
  KumaGroupWriter,
  KumaMonitorReader,
  KumaMonitorWriter,
} from '../infrastructure/kuma/kuma-monitors.js'
import {
  databaseUrl,
  resetKuma,
  type SeedService,
  seedDokploy,
  silentLogger,
  withKuma,
} from '../testing/fixtures.js'
import { type ReconcileMonitorsInput, reconcileMonitors } from './reconcile-monitors.js'

const input: ReconcileMonitorsInput = {
  isDryRun: false,
  onRemove: 'pause',
  maxRetireRatio: 0.5,
  isGrouped: true,
  rules: { healthPaths: [], acceptedStatusCodes: [] },
  exclusions: { hosts: [], projects: [], services: [], middlewares: [] },
  monitorSettings: { intervalSeconds: 60, retries: 2, timeoutSeconds: 16, notificationIds: [] },
}

const cycle = (overrides: Partial<ReconcileMonitorsInput> = {}) =>
  withKuma((session) =>
    reconcileMonitors(
      { ...input, ...overrides },
      {
        domains: new PostgresDomainSource(databaseUrl()),
        monitorReader: new KumaMonitorReader(session),
        monitorWriter: new KumaMonitorWriter(session),
        groupWriter: new KumaGroupWriter(session),
        logger: silentLogger,
      },
    ),
  )

const service = (domainIds: string[], projectId = 'p1'): SeedService => ({
  projectId,
  projectName: projectId === 'p1' ? 'shop' : 'blog',
  kind: 'application',
  serviceId: `${projectId}-a1`,
  serviceName: 'web',
  domains: domainIds.map((domainId) => ({ domainId, host: `${domainId}.example.com` })),
})

const listMonitors = () => withKuma((session) => new KumaMonitorReader(session).listMonitors())

const counts = (plan: Awaited<ReturnType<typeof cycle>>) => ({
  create: plan.create.length,
  update: plan.update.length,
  revive: plan.revive.length,
  retire: plan.retire.length,
})

describe('reconcileMonitors end to end', () => {
  beforeEach(resetKuma)

  it('converges: the second cycle has nothing left to do', async () => {
    await seedDokploy([service(['a', 'b', 'c'])])
    assert.deepEqual(counts(await cycle()), { create: 3, update: 0, revive: 0, retire: 0 })
    assert.deepEqual(counts(await cycle()), { create: 0, update: 0, revive: 0, retire: 0 })
  })

  it('pauses a removed domain and resumes it when it comes back', async () => {
    await seedDokploy([service(['a', 'b', 'c'])])
    await cycle()

    await seedDokploy([service(['a', 'b'])])
    assert.deepEqual(counts(await cycle()), { create: 0, update: 0, revive: 0, retire: 1 })
    const paused = await listMonitors()
    assert.equal(paused.filter((monitor) => !monitor.isActive).length, 1)

    await seedDokploy([service(['a', 'b', 'c'])])
    assert.deepEqual(counts(await cycle()), { create: 0, update: 0, revive: 1, retire: 0 })
  })

  it('builds one group per project and puts each domain under its own', async () => {
    await seedDokploy([service(['a', 'b'], 'p1'), service(['c'], 'p2')])
    await cycle()
    assert.deepEqual(counts(await cycle()), { create: 0, update: 0, revive: 0, retire: 0 })

    const monitors = await listMonitors()
    const groups = new Map(monitors.filter((m) => m.isGroup).map((m) => [m.id, m.name]))
    const placement = monitors
      .filter((m) => !m.isGroup)
      .map((m) => `${groups.get(m.parentId ?? -1)} > ${m.name}`)
      .sort()
    assert.deepEqual(placement, [
      'blog > web · c.example.com',
      'shop > web · a.example.com',
      'shop > web · b.example.com',
    ])
  })

  it('deletes a project group once its last domain is deleted', async () => {
    await seedDokploy([service(['a'], 'p1'), service(['c'], 'p2')])
    await cycle()

    await seedDokploy([service(['a'], 'p1')])
    await cycle({ onRemove: 'delete' })

    const names = (await listMonitors()).map((monitor) => monitor.name).sort()
    assert.deepEqual(names, ['shop', 'web · a.example.com'])
  })

  it('pushes a changed setting to the monitors it already made', async () => {
    await seedDokploy([service(['a'])])
    await cycle()

    const slower = { ...input.monitorSettings, intervalSeconds: 120, retries: 4 }
    assert.equal((await cycle({ monitorSettings: slower })).update.length, 1)
    assert.equal((await cycle({ monitorSettings: slower })).update.length, 0)
  })
})
