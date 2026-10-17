import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DokployDomain } from '../domain/dokploy-domain.js'
import type { GroupSpec, Monitor, MonitorSpec } from '../domain/monitor.js'
import { describeGroupOwnership, describeOwnership } from '../domain/ownership.js'
import type {
  IDomainSource,
  IGroupWriter,
  IMonitorReader,
  IMonitorWriter,
} from '../domain/ports.js'
import type { ILogger } from './logger.js'
import { type ReconcileMonitorsInput, reconcileMonitors } from './reconcile-monitors.js'

type Call = [method: string, ...args: unknown[]]

class FakeKuma implements IMonitorReader, IMonitorWriter, IGroupWriter {
  readonly calls: Call[] = []
  readonly parents = new Map<string, number | null>()
  readonly specs: MonitorSpec[] = []
  #nextId = 100

  constructor(
    private readonly monitors: Monitor[],
    private readonly failOn?: string,
  ) {}

  async listMonitors(): Promise<Monitor[]> {
    return this.monitors
  }

  async createMonitor(spec: MonitorSpec): Promise<number> {
    this.#record('createMonitor', spec.url)
    this.specs.push(spec)
    this.parents.set(spec.url, spec.parentId)
    return this.#nextId++
  }

  async updateMonitor(id: number, spec: MonitorSpec): Promise<void> {
    this.#record('updateMonitor', id, spec.url)
    this.parents.set(spec.url, spec.parentId)
  }

  async pauseMonitor(id: number): Promise<void> {
    this.#record('pauseMonitor', id)
  }

  async resumeMonitor(id: number): Promise<void> {
    this.#record('resumeMonitor', id)
  }

  async deleteMonitor(id: number): Promise<void> {
    this.#record('deleteMonitor', id)
  }

  async createGroup(spec: GroupSpec): Promise<number> {
    this.#record('createGroup', spec.name)
    return this.#nextId++
  }

  async updateGroup(id: number, spec: GroupSpec): Promise<void> {
    this.#record('updateGroup', id, spec.name)
  }

  async deleteGroup(id: number): Promise<void> {
    this.#record('deleteGroup', id)
  }

  #record(method: string, ...args: unknown[]): void {
    if (this.failOn === method) {
      throw new Error(`${method} rejected`)
    }
    this.calls.push([method, ...args])
  }
}

const silent: ILogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const source = (domains: DokployDomain[]): IDomainSource => ({ listDomains: async () => domains })

const domain = (domainId: string, host = `${domainId}.example.com`): DokployDomain => ({
  domainId,
  host,
  isHttps: true,
  path: '/',
  domainType: 'application',
  serviceName: 'api',
  environmentName: 'production',
  isDefaultEnvironment: true,
  projectId: 'p1',
  projectName: 'proj',
})

const managed = (id: number, domainId: string, overrides: Partial<Monitor> = {}): Monitor => ({
  id,
  name: `proj · api · ${domainId}.example.com`,
  url: `https://${domainId}.example.com`,
  isGroup: false,
  parentId: null,
  isActive: true,
  description: describeOwnership(domainId),
  ...overrides,
})

const input = (overrides: Partial<ReconcileMonitorsInput> = {}): ReconcileMonitorsInput => ({
  isDryRun: false,
  onRemove: 'pause',
  maxRetireRatio: 0.5,
  isGrouped: false,
  rules: { healthPaths: [], acceptedStatusCodes: [] },
  monitorSettings: { intervalSeconds: 60, retries: 2, timeoutSeconds: 16, notificationIds: [] },
  ...overrides,
})

const run = (
  kuma: FakeKuma,
  domains: DokployDomain[],
  overrides?: Partial<ReconcileMonitorsInput>,
) =>
  reconcileMonitors(input(overrides), {
    domains: source(domains),
    monitorReader: kuma,
    monitorWriter: kuma,
    groupWriter: kuma,
    logger: silent,
  })

describe('reconcileMonitors', () => {
  it('writes nothing when Dokploy returns zero domains', async () => {
    const kuma = new FakeKuma([managed(1, 'a'), managed(2, 'b')])
    await assert.rejects(run(kuma, []), /zero domains/)
    assert.deepEqual(kuma.calls, [])
  })

  it('writes nothing when the plan would retire too many monitors', async () => {
    const monitors = ['a', 'b', 'c', 'd'].map((id, index) => managed(index + 1, id))
    const kuma = new FakeKuma(monitors)
    await assert.rejects(run(kuma, [domain('a')]), /refusing as a safety measure/)
    assert.deepEqual(kuma.calls, [])
  })

  it('writes nothing on a dry run but still returns the plan', async () => {
    const kuma = new FakeKuma([managed(1, 'gone'), managed(2, 'paused', { isActive: false })])
    const plan = await run(kuma, [domain('new'), domain('paused')], { isDryRun: true })
    assert.deepEqual(kuma.calls, [])
    assert.equal(plan.create.length, 1)
    assert.equal(plan.revive.length, 1)
    assert.equal(plan.retire.length, 1)
  })

  it('creates, updates and resumes what the plan says', async () => {
    const kuma = new FakeKuma([
      managed(1, 'moved'),
      managed(2, 'paused', { isActive: false }),
      managed(3, 'same'),
    ])
    await run(kuma, [
      domain('new'),
      domain('moved', 'elsewhere.example.com'),
      domain('paused'),
      domain('same'),
    ])
    assert.deepEqual(kuma.calls, [
      ['createMonitor', 'https://new.example.com'],
      ['updateMonitor', 1, 'https://elsewhere.example.com'],
      ['resumeMonitor', 2],
    ])
  })

  it('pauses a retired monitor by default, keeping its history', async () => {
    const kuma = new FakeKuma([managed(1, 'keep'), managed(2, 'gone')])
    await run(kuma, [domain('keep')])
    assert.deepEqual(kuma.calls, [['pauseMonitor', 2]])
  })

  it('deletes a retired monitor only when told to', async () => {
    const kuma = new FakeKuma([managed(1, 'keep'), managed(2, 'gone')])
    await run(kuma, [domain('keep')], { onRemove: 'delete' })
    assert.deepEqual(kuma.calls, [['deleteMonitor', 2]])
  })

  it('never touches monitors it does not own', async () => {
    const foreign: Monitor = {
      id: 9,
      name: 'hand made',
      url: null,
      isGroup: false,
      parentId: null,
      isActive: true,
      description: null,
    }
    const kuma = new FakeKuma([managed(1, 'keep'), foreign])
    await run(kuma, [domain('keep')], { onRemove: 'delete' })
    assert.deepEqual(kuma.calls, [])
  })

  it('stops at the first failed write and leaves the rest for the next cycle', async () => {
    const kuma = new FakeKuma([managed(1, 'keep'), managed(2, 'gone')], 'pauseMonitor')
    await assert.rejects(run(kuma, [domain('keep'), domain('new')]), /pauseMonitor rejected/)
    assert.deepEqual(kuma.calls, [['createMonitor', 'https://new.example.com']])
  })

  it('creates the project group first and puts the new monitor under it', async () => {
    const kuma = new FakeKuma([])
    await run(kuma, [domain('new')], { isGrouped: true })
    assert.deepEqual(kuma.calls, [
      ['createGroup', 'proj'],
      ['createMonitor', 'https://new.example.com'],
    ])
    assert.equal(kuma.parents.get('https://new.example.com'), 100)
  })

  it('deletes an emptied group only after its last child is gone', async () => {
    const group: Monitor = {
      id: 50,
      name: 'proj',
      url: null,
      isGroup: true,
      parentId: null,
      isActive: true,
      description: describeGroupOwnership('p2'),
    }
    const child = managed(2, 'gone', { name: 'api · gone.example.com', parentId: 50 })
    const kuma = new FakeKuma([managed(1, 'keep'), group, child])
    await run(kuma, [domain('keep')], { onRemove: 'delete' })
    assert.deepEqual(kuma.calls, [
      ['deleteMonitor', 2],
      ['deleteGroup', 50],
    ])
  })

  it('probes the configured health path and accepts the configured codes', async () => {
    const kuma = new FakeKuma([])
    await run(kuma, [domain('api'), domain('web')], {
      rules: {
        healthPaths: [{ pattern: 'api.*', value: '/health' }],
        acceptedStatusCodes: [{ pattern: 'web.example.com', value: ['200-299', '401'] }],
      },
    })
    assert.deepEqual(
      kuma.specs.map(({ url, acceptedStatusCodes }) => [url, acceptedStatusCodes]),
      [
        ['https://api.example.com/health', ['200-299']],
        ['https://web.example.com', ['200-299', '401']],
      ],
    )
  })
})
