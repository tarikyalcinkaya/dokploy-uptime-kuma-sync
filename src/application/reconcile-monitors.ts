import { findGuardViolation } from '../domain/guard.js'
import type { MonitorSettings } from '../domain/monitor.js'
import type { IDomainSource, IMonitorReader, IMonitorWriter } from '../domain/ports.js'
import { buildPlan, type ReconcilePlan } from '../domain/reconcile-plan.js'
import type { ILogger } from './logger.js'

export type RemovalAction = 'pause' | 'delete'

export interface ReconcileMonitorsInput {
  isDryRun: boolean
  onRemove: RemovalAction
  maxRetireRatio: number
  monitorSettings: MonitorSettings
}

export interface ReconcileMonitorsDeps {
  domains: IDomainSource
  monitorReader: IMonitorReader
  monitorWriter: IMonitorWriter
  logger: ILogger
}

const logPlan = (plan: ReconcilePlan, logger: ILogger): void => {
  logger.info(
    {
      domains: plan.domainCount,
      managed: plan.managedCount,
      create: plan.create.length,
      update: plan.update.length,
      revive: plan.revive.length,
      retire: plan.retire.length,
    },
    'reconcile plan',
  )
}

const reportDryRun = (plan: ReconcilePlan, onRemove: RemovalAction, logger: ILogger): void => {
  for (const { domain, spec } of plan.create) {
    logger.info({ host: domain.host, url: spec.url }, 'would create')
  }
  for (const { domain, spec } of plan.update) {
    logger.info({ host: domain.host, url: spec.url }, 'would update')
  }
  for (const { domain, monitor } of plan.revive) {
    logger.info({ host: domain.host, monitorId: monitor.id }, 'would resume')
  }
  for (const monitor of plan.retire) {
    logger.info({ name: monitor.name }, `would ${onRemove}`)
  }
  logger.warn('DRY_RUN is on — no changes were sent to Kuma')
}

const applyPlan = async (
  plan: ReconcilePlan,
  onRemove: RemovalAction,
  { monitorWriter: monitors, logger }: ReconcileMonitorsDeps,
): Promise<void> => {
  for (const { domain, spec } of plan.create) {
    const id = await monitors.createMonitor(spec)
    logger.info({ host: domain.host, monitorId: id }, 'monitor created')
  }

  for (const { monitor, domain, spec } of plan.update) {
    await monitors.updateMonitor(monitor.id, spec)
    logger.info({ host: domain.host, monitorId: monitor.id }, 'monitor updated')
  }

  for (const { monitor, domain } of plan.revive) {
    await monitors.resumeMonitor(monitor.id)
    logger.info({ host: domain.host, monitorId: monitor.id }, 'monitor resumed')
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
}

// A run that fails halfway leaves the rest for the next cycle, which recomputes the plan from scratch.
export const reconcileMonitors = async (
  input: ReconcileMonitorsInput,
  deps: ReconcileMonitorsDeps,
): Promise<ReconcilePlan> => {
  const [domains, monitors] = await Promise.all([
    deps.domains.listDomains(),
    deps.monitorReader.listMonitors(),
  ])

  const plan = buildPlan(domains, monitors, input.monitorSettings)
  logPlan(plan, deps.logger)

  const violation = findGuardViolation(plan, input.maxRetireRatio)
  if (violation) {
    throw new Error(violation)
  }

  if (input.isDryRun) {
    reportDryRun(plan, input.onRemove, deps.logger)
    return plan
  }

  await applyPlan(plan, input.onRemove, deps)
  return plan
}
