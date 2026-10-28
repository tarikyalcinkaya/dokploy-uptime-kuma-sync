import { type DokployDomain, toMonitorName, toMonitorUrl } from './dokploy-domain.js'
import { isWatched, uniqueEndpoints } from './endpoint.js'
import {
  buildGroupPlan,
  findManagedGroups,
  findRetiredGroups,
  groupKeyOf,
  survivingChildParents,
} from './group-plan.js'
import { findHostRule } from './host-rule.js'
import { DEFAULT_ACCEPTED_STATUS_CODES, type Monitor } from './monitor.js'
import { needsUpdate } from './monitor-diff.js'
import { describeOwnership, readOwnedDomainId, readPausedAt } from './ownership.js'
import type { PlanOptions, PlannedMonitor, ReconcilePlan } from './plan-types.js'

export type {
  MonitorRules,
  PlanOptions,
  PlannedChange,
  PlannedMonitor,
  ReconcilePlan,
  RemovalAction,
  StampedMonitor,
} from './plan-types.js'

const planMonitor = (
  domain: DokployDomain,
  options: PlanOptions,
  existingGroupIds: ReadonlyMap<string, number>,
): PlannedMonitor => {
  const groupKey = groupKeyOf(domain, options.isGrouped)
  const parentId = groupKey ? (existingGroupIds.get(groupKey) ?? null) : null
  return {
    domain,
    spec: {
      name: toMonitorName(domain, groupKey !== null),
      url: toMonitorUrl(domain, findHostRule(options.rules.healthPaths, domain.host)),
      description: describeOwnership(domain.domainId),
      parentId,
      acceptedStatusCodes:
        findHostRule(options.rules.acceptedStatusCodes, domain.host) ??
        DEFAULT_ACCEPTED_STATUS_CODES,
      settings:
        domain.isDefaultEnvironment === false
          ? { ...options.settings, intervalSeconds: options.otherEnvironmentIntervalSeconds }
          : options.settings,
    },
    pendingGroupKey: groupKey && parentId === null ? groupKey : null,
  }
}

const MILLISECONDS_PER_DAY = 86_400_000

const findManagedMonitors = (monitors: Monitor[]): Map<string, Monitor> => {
  const managed = new Map<string, Monitor>()
  for (const monitor of monitors) {
    const domainId = monitor.isGroup ? null : readOwnedDomainId(monitor)
    if (domainId) {
      managed.set(domainId, monitor)
    }
  }
  return managed
}

export const buildPlan = (
  allDomains: DokployDomain[],
  monitors: Monitor[],
  options: PlanOptions,
): ReconcilePlan => {
  const managed = findManagedMonitors(monitors)
  const ownedIds = new Set(managed.keys())
  const domains = uniqueEndpoints(allDomains, options.rules.healthPaths, ownedIds)
  const groups = findManagedGroups(monitors)
  const watched = domains.filter((domain) => isWatched(domain, ownedIds))
  const groupPlan = buildGroupPlan(
    watched,
    groups,
    options.isGrouped,
    options.settings.intervalSeconds,
  )

  const plan: Omit<ReconcilePlan, 'groups'> = {
    create: [],
    update: [],
    revive: [],
    suspend: [],
    retire: [],
    stamp: [],
    expire: [],
    stopped: domains.filter((domain) => domain.isStopped),
    managedCount: managed.size,
    domainCount: domains.length,
  }

  const seen = new Set<string>()
  for (const domain of domains) {
    seen.add(domain.domainId)
    const planned = planMonitor(domain, options, groupPlan.existingIds)
    const monitor = managed.get(domain.domainId)

    if (!monitor) {
      if (!domain.isStopped) {
        plan.create.push(planned)
      }
      continue
    }
    // A stopped service is a planned outage, not a removal: the monitor keeps its history and no expiry clock runs.
    if (domain.isStopped) {
      if (monitor.isActive) {
        plan.suspend.push({ ...planned, monitor })
      }
    } else if (!monitor.isActive) {
      plan.revive.push({ ...planned, monitor })
    }
    if (needsUpdate(monitor, planned)) {
      plan.update.push({ ...planned, monitor })
    }
  }

  const stampNow = (domainId: string, monitor: Monitor) =>
    plan.stamp.push({ monitor, description: describeOwnership(domainId, options.now) })
  const retentionMs = options.pausedRetentionDays * MILLISECONDS_PER_DAY
  for (const [domainId, monitor] of managed) {
    if (seen.has(domainId)) {
      continue
    }
    if (monitor.isActive) {
      plan.retire.push(monitor)
      if (options.onRemove === 'pause') {
        stampNow(domainId, monitor)
      }
      continue
    }
    const pausedAt = readPausedAt(monitor)
    if (!pausedAt) {
      stampNow(domainId, monitor)
    } else if (retentionMs > 0 && options.now.getTime() - pausedAt.getTime() >= retentionMs) {
      plan.expire.push(monitor)
    }
  }

  const wantedKeys = new Set(
    watched
      .map((domain) => groupKeyOf(domain, options.isGrouped))
      .filter((key): key is string => key !== null),
  )
  return {
    ...plan,
    groups: {
      ...groupPlan,
      retire: findRetiredGroups(
        groups,
        wantedKeys,
        survivingChildParents(monitors, plan, options.onRemove === 'delete'),
      ),
    },
  }
}
