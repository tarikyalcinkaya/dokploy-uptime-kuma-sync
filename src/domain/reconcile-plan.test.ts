import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DokployDomain } from './dokploy-domain.js'
import { findGuardViolation } from './guard.js'
import type { Monitor, MonitorSettings } from './monitor.js'
import { describeGroupOwnership, MANAGED_MARKER_PREFIX } from './ownership.js'
import { buildPlan, type PlanOptions } from './reconcile-plan.js'

const settings: MonitorSettings = {
  intervalSeconds: 60,
  retries: 2,
  timeoutSeconds: 16,
  notificationIds: [],
  notifiesCertificateExpiry: true,
}

const flat: PlanOptions = {
  settings,
  otherEnvironmentIntervalSeconds: 300,
  rules: { healthPaths: [], acceptedStatusCodes: [] },
  isGrouped: false,
  onRemove: 'pause',
}

const grouped: PlanOptions = { ...flat, isGrouped: true }

const domain = (overrides: Partial<DokployDomain> = {}): DokployDomain => ({
  domainId: 'dom1',
  host: 'app.example.com',
  isHttps: true,
  path: '/',
  domainType: 'application',
  serviceName: 'api',
  environmentName: 'production',
  isDefaultEnvironment: true,
  projectId: 'p1',
  projectName: 'proj',
  middlewares: [],
  ...overrides,
})

const monitor = (overrides: Partial<Monitor> = {}): Monitor => ({
  id: 1,
  name: 'proj · api · app.example.com',
  url: 'https://app.example.com',
  isGroup: false,
  parentId: null,
  isActive: true,
  description: `managed\n${MANAGED_MARKER_PREFIX}dom1`,
  acceptedStatusCodes: ['200-299'],
  settings,
  ...overrides,
})

describe('buildPlan', () => {
  it('creates a monitor for an unseen domain', () => {
    const plan = buildPlan([domain()], [], flat)
    assert.equal(plan.create.length, 1)
    assert.equal(plan.update.length, 0)
    assert.equal(plan.retire.length, 0)
  })

  it('leaves a matching monitor untouched', () => {
    const plan = buildPlan([domain()], [monitor()], flat)
    assert.deepEqual([plan.create.length, plan.update.length, plan.retire.length], [0, 0, 0])
  })

  it('updates when the url changes instead of creating a duplicate', () => {
    const plan = buildPlan([domain({ host: 'new.example.com' })], [monitor()], flat)
    assert.equal(plan.create.length, 0)
    assert.equal(plan.update.length, 1)
  })

  it('retires a monitor whose domain is gone', () => {
    const plan = buildPlan([], [monitor()], flat)
    assert.equal(plan.retire.length, 1)
  })

  it('resumes a paused monitor whose domain came back', () => {
    const plan = buildPlan([domain()], [monitor({ isActive: false })], flat)
    assert.equal(plan.revive.length, 1)
    assert.equal(plan.retire.length, 0)
  })

  it('ignores monitors it does not manage', () => {
    const foreign = monitor({ id: 99, description: 'hand made' })
    const plan = buildPlan([], [foreign], flat)
    assert.equal(plan.retire.length, 0)
    assert.equal(plan.managedCount, 0)
  })
})

const group = (overrides: Partial<Monitor> = {}): Monitor => ({
  id: 50,
  name: 'proj',
  url: null,
  isGroup: true,
  parentId: null,
  isActive: true,
  description: describeGroupOwnership('p1'),
  acceptedStatusCodes: ['200-299'],
  settings,
  ...overrides,
})

describe('buildPlan settings propagation', () => {
  const placed = { name: 'proj · api · app.example.com' }

  it('updates when the interval, retries or timeout changed', () => {
    const changes = [
      { intervalSeconds: 300 },
      { retries: 5 },
      { timeoutSeconds: 30 },
      { notifiesCertificateExpiry: false },
    ]
    for (const change of changes) {
      const plan = buildPlan(
        [domain()],
        [monitor({ ...placed, settings: { ...settings, ...change } })],
        flat,
      )
      assert.equal(plan.update.length, 1, JSON.stringify(change))
    }
  })

  it('updates when the notifications changed but not when only their order did', () => {
    const wanted = { ...flat, settings: { ...settings, notificationIds: ['1', '2'] } }
    const swapped = monitor({ settings: { ...settings, notificationIds: ['2', '1'] } })
    assert.equal(buildPlan([domain()], [swapped], wanted).update.length, 0)
    assert.equal(buildPlan([domain()], [monitor()], wanted).update.length, 1)
  })

  it('updates when the accepted status codes changed', () => {
    const plan = buildPlan([domain()], [monitor({ acceptedStatusCodes: ['200-299', '401'] })], flat)
    assert.equal(plan.update.length, 1)
  })
})

describe('buildPlan duplicate endpoints', () => {
  it('opens one monitor for several domains on the same host and path, preferring https', () => {
    const plan = buildPlan(
      [
        domain({ domainId: 'http', isHttps: false }),
        domain({ domainId: 'https' }),
        domain({ domainId: 'again', host: 'APP.example.com' }),
        domain({ domainId: 'sub', path: '/api' }),
      ],
      [],
      flat,
    )
    assert.deepEqual(
      plan.create.map(({ domain: { domainId } }) => domainId),
      ['https', 'sub'],
    )
  })

  it('keeps the duplicate that already has a monitor, even over https', () => {
    const plan = buildPlan(
      [domain({ isHttps: false }), domain({ domainId: 'dom2' })],
      [monitor({ url: 'http://app.example.com' })],
      flat,
    )
    assert.deepEqual([plan.create.length, plan.update.length, plan.retire.length], [0, 0, 0])
  })

  it('retires the monitor a duplicate already had', () => {
    const duplicate = monitor({ id: 2, description: `x\n${MANAGED_MARKER_PREFIX}dom2` })
    const plan = buildPlan([domain(), domain({ domainId: 'dom2' })], [monitor(), duplicate], flat)
    assert.deepEqual(
      plan.retire.map(({ id }) => id),
      [2],
    )
  })

  it('counts two paths that share a health path as one endpoint', () => {
    const rules = { healthPaths: [{ pattern: 'app.*', value: '/health' }], acceptedStatusCodes: [] }
    const plan = buildPlan([domain(), domain({ domainId: 'dom2', path: '/api' })], [], {
      ...flat,
      rules,
    })
    assert.equal(plan.create.length, 1)
  })
})

describe('buildPlan intervals', () => {
  it('checks the default environment at the main interval and the others less often', () => {
    const staging = domain({
      domainId: 'dom2',
      host: 'staging.example.com',
      environmentName: 'staging',
      isDefaultEnvironment: false,
    })
    const plan = buildPlan([domain(), staging], [], flat)
    assert.deepEqual(
      plan.create.map(({ spec }) => spec.settings.intervalSeconds),
      [60, 300],
    )
  })
})

describe('buildPlan with project groups', () => {
  it('keeps the project in the name of a domain that has no project to group under', () => {
    const plan = buildPlan([domain({ projectId: null })], [], grouped)
    assert.equal(plan.create[0]?.spec.name, 'proj · api · app.example.com')
    assert.equal(plan.groups.create.length, 0)
  })

  it('moves a child to its new project and deletes the group it left empty', () => {
    const other = group({ id: 60, name: 'old', description: describeGroupOwnership('p0') })
    const placed = monitor({ name: 'api · app.example.com', parentId: 60 })
    const plan = buildPlan([domain()], [group(), other, placed], grouped)
    assert.equal(plan.update[0]?.spec.parentId, 50)
    assert.deepEqual(
      plan.groups.retire.map(({ id }) => id),
      [60],
    )
  })

  it('creates the group and leaves the parent to be filled once it exists', () => {
    const plan = buildPlan([domain()], [], grouped)
    assert.deepEqual(
      plan.groups.create.map(({ key, spec }) => [key, spec.name]),
      [['p1', 'proj']],
    )
    assert.equal(plan.create[0]?.pendingGroupKey, 'p1')
    assert.equal(plan.create[0]?.spec.parentId, null)
  })

  it('creates one group per project, not per domain', () => {
    const plan = buildPlan(
      [domain(), domain({ domainId: 'dom2', host: 'b.example.com' })],
      [],
      grouped,
    )
    assert.equal(plan.groups.create.length, 1)
  })

  it('moves an ungrouped monitor under its existing group', () => {
    const plan = buildPlan([domain()], [group(), monitor()], grouped)
    assert.equal(plan.groups.create.length, 0)
    assert.equal(plan.update[0]?.spec.parentId, 50)
    assert.equal(plan.update[0]?.spec.name, 'api · app.example.com')
  })

  it('leaves a monitor already in place untouched', () => {
    const placed = monitor({ name: 'api · app.example.com', parentId: 50 })
    const plan = buildPlan([domain()], [group(), placed], grouped)
    assert.deepEqual([plan.create.length, plan.update.length, plan.groups.retire.length], [0, 0, 0])
  })

  it('renames the group with its project', () => {
    const placed = monitor({ name: 'api · app.example.com', parentId: 50 })
    const plan = buildPlan([domain({ projectName: 'renamed' })], [group(), placed], grouped)
    assert.equal(plan.groups.update[0]?.spec.name, 'renamed')
  })

  it('keeps the group while a paused child still holds its history', () => {
    const placed = monitor({ name: 'api · app.example.com', parentId: 50 })
    const plan = buildPlan([], [group(), placed], grouped)
    assert.equal(plan.retire.length, 1)
    assert.equal(plan.groups.retire.length, 0)
  })

  it('deletes the group once its last child is deleted', () => {
    const placed = monitor({ name: 'api · app.example.com', parentId: 50 })
    const plan = buildPlan([], [group(), placed], { ...grouped, onRemove: 'delete' })
    assert.deepEqual(
      plan.groups.retire.map(({ id }) => id),
      [50],
    )
  })

  it('never deletes a group that holds a monitor added by hand', () => {
    const handMade = monitor({ id: 7, description: 'mine', parentId: 50 })
    const plan = buildPlan([], [group(), handMade], { ...grouped, onRemove: 'delete' })
    assert.equal(plan.groups.retire.length, 0)
  })

  it('takes monitors out of their groups and drops the groups when grouping is off', () => {
    const placed = monitor({ name: 'api · app.example.com', parentId: 50 })
    const plan = buildPlan([domain()], [group(), placed], flat)
    assert.equal(plan.update[0]?.spec.parentId, null)
    assert.equal(plan.groups.retire.length, 1)
  })

  it('does not treat a managed group as a domain monitor', () => {
    const plan = buildPlan([domain()], [group()], grouped)
    assert.equal(plan.managedCount, 0)
    assert.equal(plan.retire.length, 0)
  })
})

describe('findGuardViolation', () => {
  it('blocks retiring everything when Dokploy returns nothing', () => {
    const plan = buildPlan(
      [],
      [monitor(), monitor({ id: 2, description: `x\n${MANAGED_MARKER_PREFIX}dom2` })],
      flat,
    )
    assert.match(findGuardViolation(plan, 0.5) ?? '', /zero domains/)
  })

  it('allows a single removal even from a small managed set', () => {
    const plan = buildPlan(
      [domain()],
      [monitor(), monitor({ id: 2, description: `x\n${MANAGED_MARKER_PREFIX}dom2` })],
      flat,
    )
    assert.equal(plan.retire.length, 1)
    assert.equal(findGuardViolation(plan, 0.5), null)
  })

  it('blocks a mass removal that exceeds the ratio', () => {
    const monitors = Array.from({ length: 10 }, (_, index) =>
      monitor({ id: index + 1, description: `x\n${MANAGED_MARKER_PREFIX}dom${index}` }),
    )
    const plan = buildPlan([domain({ domainId: 'dom0' })], monitors, flat)
    assert.match(findGuardViolation(plan, 0.5) ?? '', /refusing as a safety measure/)
  })
})
