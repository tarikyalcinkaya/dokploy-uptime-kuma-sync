import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DokployDomain } from './dokploy-domain.js'
import { findGuardViolation } from './guard.js'
import type { Monitor, MonitorSettings } from './monitor.js'
import { MANAGED_MARKER_PREFIX } from './ownership.js'
import { buildPlan } from './reconcile-plan.js'

const settings: MonitorSettings = {
  intervalSeconds: 60,
  retries: 2,
  timeoutSeconds: 16,
  notificationIds: [],
}

const domain = (overrides: Partial<DokployDomain> = {}): DokployDomain => ({
  domainId: 'dom1',
  host: 'app.example.com',
  isHttps: true,
  path: '/',
  domainType: 'application',
  serviceName: 'api',
  environmentName: 'production',
  projectName: 'proj',
  ...overrides,
})

const monitor = (overrides: Partial<Monitor> = {}): Monitor => ({
  id: 1,
  name: 'proj/api · app.example.com',
  url: 'https://app.example.com',
  isActive: true,
  description: `managed\n${MANAGED_MARKER_PREFIX}dom1`,
  ...overrides,
})

describe('buildPlan', () => {
  it('creates a monitor for an unseen domain', () => {
    const plan = buildPlan([domain()], [], settings)
    assert.equal(plan.create.length, 1)
    assert.equal(plan.update.length, 0)
    assert.equal(plan.retire.length, 0)
  })

  it('leaves a matching monitor untouched', () => {
    const plan = buildPlan([domain()], [monitor()], settings)
    assert.deepEqual([plan.create.length, plan.update.length, plan.retire.length], [0, 0, 0])
  })

  it('updates when the url changes instead of creating a duplicate', () => {
    const plan = buildPlan([domain({ host: 'new.example.com' })], [monitor()], settings)
    assert.equal(plan.create.length, 0)
    assert.equal(plan.update.length, 1)
  })

  it('retires a monitor whose domain is gone', () => {
    const plan = buildPlan([], [monitor()], settings)
    assert.equal(plan.retire.length, 1)
  })

  it('resumes a paused monitor whose domain came back', () => {
    const plan = buildPlan([domain()], [monitor({ isActive: false })], settings)
    assert.equal(plan.revive.length, 1)
    assert.equal(plan.retire.length, 0)
  })

  it('ignores monitors it does not manage', () => {
    const foreign = monitor({ id: 99, description: 'hand made' })
    const plan = buildPlan([], [foreign], settings)
    assert.equal(plan.retire.length, 0)
    assert.equal(plan.managedCount, 0)
  })
})

describe('findGuardViolation', () => {
  it('blocks retiring everything when Dokploy returns nothing', () => {
    const plan = buildPlan(
      [],
      [monitor(), monitor({ id: 2, description: `x\n${MANAGED_MARKER_PREFIX}dom2` })],
      settings,
    )
    assert.match(findGuardViolation(plan, 0.5) ?? '', /zero domains/)
  })

  it('allows a single removal even from a small managed set', () => {
    const plan = buildPlan(
      [domain()],
      [monitor(), monitor({ id: 2, description: `x\n${MANAGED_MARKER_PREFIX}dom2` })],
      settings,
    )
    assert.equal(plan.retire.length, 1)
    assert.equal(findGuardViolation(plan, 0.5), null)
  })

  it('blocks a mass removal that exceeds the ratio', () => {
    const monitors = Array.from({ length: 10 }, (_, index) =>
      monitor({ id: index + 1, description: `x\n${MANAGED_MARKER_PREFIX}dom${index}` }),
    )
    const plan = buildPlan([domain({ domainId: 'dom0' })], monitors, settings)
    assert.match(findGuardViolation(plan, 0.5) ?? '', /refusing as a safety measure/)
  })
})
