import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { PostgresDomainSource } from '../infrastructure/dokploy/postgres-domain-source.js'
import { KumaMonitorReader, KumaMonitorWriter } from '../infrastructure/kuma/kuma-monitors.js'
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
  monitorSettings: { intervalSeconds: 60, retries: 2, timeoutSeconds: 16, notificationIds: [] },
}

const cycle = () =>
  withKuma((session) =>
    reconcileMonitors(input, {
      domains: new PostgresDomainSource(databaseUrl()),
      monitorReader: new KumaMonitorReader(session),
      monitorWriter: new KumaMonitorWriter(session),
      logger: silentLogger,
    }),
  )

const service = (domainIds: string[]): SeedService => ({
  projectId: 'p1',
  projectName: 'shop',
  kind: 'application',
  serviceId: 'a1',
  serviceName: 'web',
  domains: domainIds.map((domainId) => ({ domainId, host: `${domainId}.example.com` })),
})

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
    const paused = await withKuma((session) => new KumaMonitorReader(session).listMonitors())
    assert.equal(paused.filter((monitor) => !monitor.isActive).length, 1)

    await seedDokploy([service(['a', 'b', 'c'])])
    assert.deepEqual(counts(await cycle()), { create: 0, update: 0, revive: 1, retire: 0 })
  })
})
