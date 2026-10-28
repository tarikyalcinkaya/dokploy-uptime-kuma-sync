import type { ReconcilePlan, RemovalAction } from '../domain/reconcile-plan.js'
import type { ILogger } from './logger.js'

export const logPlanSummary = (plan: ReconcilePlan, logger: ILogger): void => {
  logger.info(
    {
      domains: plan.domainCount,
      managed: plan.managedCount,
      create: plan.create.length,
      update: plan.update.length,
      revive: plan.revive.length,
      suspend: plan.suspend.length,
      stopped: plan.stopped.length,
      retire: plan.retire.length,
      expire: plan.expire.length,
      groupsCreate: plan.groups.create.length,
      groupsUpdate: plan.groups.update.length,
      groupsRetire: plan.groups.retire.length,
    },
    'reconcile plan',
  )
}

export const logDryRun = (plan: ReconcilePlan, onRemove: RemovalAction, logger: ILogger): void => {
  for (const domain of plan.stopped) {
    logger.info({ host: domain.host, service: domain.serviceName }, 'stopped service')
  }
  for (const { spec } of plan.groups.create) {
    logger.info({ group: spec.name }, 'would create group')
  }
  for (const { group, spec } of plan.groups.update) {
    logger.info({ from: group.name, to: spec.name }, 'would rename group')
  }
  for (const { domain, spec } of plan.create) {
    logger.info({ host: domain.host, url: spec.url, name: spec.name }, 'would create')
  }
  for (const { domain, spec } of plan.update) {
    logger.info({ host: domain.host, url: spec.url, name: spec.name }, 'would update')
  }
  for (const { domain, monitor } of plan.revive) {
    logger.info({ host: domain.host, monitorId: monitor.id }, 'would resume')
  }
  for (const { domain, monitor } of plan.suspend) {
    logger.info({ host: domain.host, monitorId: monitor.id }, 'would pause stopped service')
  }
  for (const monitor of plan.retire) {
    logger.info({ name: monitor.name }, `would ${onRemove}`)
  }
  for (const monitor of plan.expire) {
    logger.info({ name: monitor.name }, 'would delete expired paused monitor')
  }
  for (const group of plan.groups.retire) {
    logger.info({ group: group.name }, 'would delete empty group')
  }
  logger.warn('DRY_RUN is on — no changes were sent to Kuma')
}
