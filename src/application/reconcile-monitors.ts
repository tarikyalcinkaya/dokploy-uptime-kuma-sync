import { type Exclusions, isExcluded } from '../domain/exclusion.js'
import { findGuardViolation } from '../domain/guard.js'
import type { MonitorSettings, MonitorSpec } from '../domain/monitor.js'
import type {
  IDomainSource,
  IGroupWriter,
  IMonitorReader,
  IMonitorWriter,
} from '../domain/ports.js'
import {
  buildPlan,
  type MonitorRules,
  type PlannedMonitor,
  type ReconcilePlan,
  type RemovalAction,
} from '../domain/reconcile-plan.js'
import type { ILogger } from './logger.js'
import { logDryRun, logPlanSummary } from './plan-report.js'

export interface ReconcileMonitorsInput {
  isDryRun: boolean
  onRemove: RemovalAction
  maxRetireRatio: number
  isGrouped: boolean
  monitorSettings: MonitorSettings
  otherEnvironmentIntervalSeconds: number
  rules: MonitorRules
  exclusions: Exclusions
  pausedRetentionDays: number
}

export interface ReconcileMonitorsDeps {
  domains: IDomainSource
  monitorReader: IMonitorReader
  monitorWriter: IMonitorWriter
  groupWriter: IGroupWriter
  logger: ILogger
}

const applyGroups = async (
  plan: ReconcilePlan,
  { groupWriter, logger }: ReconcileMonitorsDeps,
): Promise<Map<string, number>> => {
  const groupIds = new Map(plan.groups.existingIds)
  for (const { key, spec } of plan.groups.create) {
    const id = await groupWriter.createGroup(spec)
    groupIds.set(key, id)
    logger.info({ group: spec.name, monitorId: id }, 'group created')
  }
  for (const { group, spec } of plan.groups.update) {
    await groupWriter.updateGroup(group.id, spec)
    logger.info({ group: spec.name, monitorId: group.id }, 'group renamed')
  }
  return groupIds
}

const withParent = (planned: PlannedMonitor, groupIds: Map<string, number>): MonitorSpec =>
  planned.pendingGroupKey
    ? { ...planned.spec, parentId: groupIds.get(planned.pendingGroupKey) ?? null }
    : planned.spec

const applyPlan = async (
  plan: ReconcilePlan,
  onRemove: RemovalAction,
  deps: ReconcileMonitorsDeps,
): Promise<void> => {
  const { monitorWriter: monitors, groupWriter, logger } = deps
  const groupIds = await applyGroups(plan, deps)

  for (const planned of plan.create) {
    const id = await monitors.createMonitor(withParent(planned, groupIds))
    logger.info({ host: planned.domain.host, monitorId: id }, 'monitor created')
  }

  for (const planned of plan.update) {
    await monitors.updateMonitor(planned.monitor.id, withParent(planned, groupIds))
    logger.info({ host: planned.domain.host, monitorId: planned.monitor.id }, 'monitor updated')
  }

  for (const { monitor, domain } of plan.revive) {
    await monitors.resumeMonitor(monitor.id)
    logger.info({ host: domain.host, monitorId: monitor.id }, 'monitor resumed')
  }

  for (const { monitor, domain } of plan.suspend) {
    await monitors.pauseMonitor(monitor.id)
    logger.info({ host: domain.host, monitorId: monitor.id }, 'monitor paused: service stopped')
  }

  // The pause time is written first: a pause without it would never expire.
  for (const { monitor, description } of plan.stamp) {
    await monitors.describeMonitor(monitor.id, description)
  }

  for (const monitor of plan.retire) {
    if (onRemove === 'delete') {
      await monitors.deleteMonitor(monitor.id)
      logger.info({ monitorId: monitor.id, name: monitor.name }, 'monitor deleted')
    } else {
      await monitors.pauseMonitor(monitor.id)
      logger.info({ monitorId: monitor.id, name: monitor.name }, 'monitor paused')
    }
  }

  for (const monitor of plan.expire) {
    await monitors.deleteMonitor(monitor.id)
    logger.info({ monitorId: monitor.id, name: monitor.name }, 'expired paused monitor deleted')
  }

  for (const group of plan.groups.retire) {
    await groupWriter.deleteGroup(group.id)
    logger.info({ group: group.name, monitorId: group.id }, 'empty group deleted')
  }
}

// A run that fails halfway leaves the rest for the next cycle, which recomputes the plan from scratch.
export const reconcileMonitors = async (
  input: ReconcileMonitorsInput,
  deps: ReconcileMonitorsDeps,
): Promise<ReconcilePlan> => {
  const [allDomains, monitors] = await Promise.all([
    deps.domains.listDomains(),
    deps.monitorReader.listMonitors(),
  ])
  const domains = allDomains.filter((domain) => !isExcluded(domain, input.exclusions))
  if (domains.length < allDomains.length) {
    deps.logger.debug({ excluded: allDomains.length - domains.length }, 'domains excluded')
  }

  const plan = buildPlan(domains, monitors, {
    settings: input.monitorSettings,
    otherEnvironmentIntervalSeconds: input.otherEnvironmentIntervalSeconds,
    rules: input.rules,
    pausedRetentionDays: input.pausedRetentionDays,
    now: new Date(),
    isGrouped: input.isGrouped,
    onRemove: input.onRemove,
  })
  logPlanSummary(plan, deps.logger)

  const violation = findGuardViolation(plan, input.maxRetireRatio)
  if (violation) {
    throw new Error(violation)
  }

  if (input.isDryRun) {
    logDryRun(plan, input.onRemove, deps.logger)
    return plan
  }

  await applyPlan(plan, input.onRemove, deps)
  return plan
}
