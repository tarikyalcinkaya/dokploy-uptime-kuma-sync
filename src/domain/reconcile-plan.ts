import { type DokployDomain, toMonitorName, toMonitorUrl } from './dokploy-domain.js'
import {
  buildGroupPlan,
  findManagedGroups,
  findRetiredGroups,
  type GroupPlan,
  groupKeyOf,
} from './group-plan.js'
import { findHostRule, type HostRule } from './host-rule.js'
import {
  DEFAULT_ACCEPTED_STATUS_CODES,
  type Monitor,
  type MonitorSettings,
  type MonitorSpec,
} from './monitor.js'
import { describeOwnership, readOwnedDomainId } from './ownership.js'

export type RemovalAction = 'pause' | 'delete'

// Services whose root answers 401/404 by design need another URL or other codes to count as up.
export interface MonitorRules {
  healthPaths: HostRule<string>[]
  acceptedStatusCodes: HostRule<string[]>[]
}

export interface PlanOptions {
  settings: MonitorSettings
  rules: MonitorRules
  isGrouped: boolean
  onRemove: RemovalAction
}

export interface PlannedMonitor {
  domain: DokployDomain
  spec: MonitorSpec
  // Set when the monitor belongs in a group that this run has yet to create; its id fills
  // `spec.parentId` once the group exists.
  pendingGroupKey: string | null
}

export interface PlannedChange extends PlannedMonitor {
  monitor: Monitor
}

export interface ReconcilePlan {
  groups: GroupPlan
  create: PlannedMonitor[]
  update: PlannedChange[]
  revive: PlannedChange[]
  retire: Monitor[]
  managedCount: number
  domainCount: number
}

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
      name: toMonitorName(domain, options.isGrouped),
      url: toMonitorUrl(domain, findHostRule(options.rules.healthPaths, domain.host)),
      description: describeOwnership(domain.domainId),
      parentId,
      acceptedStatusCodes:
        findHostRule(options.rules.acceptedStatusCodes, domain.host) ??
        DEFAULT_ACCEPTED_STATUS_CODES,
      settings: options.settings,
    },
    pendingGroupKey: groupKey && parentId === null ? groupKey : null,
  }
}

const needsUpdate = (monitor: Monitor, { spec, pendingGroupKey }: PlannedMonitor): boolean =>
  monitor.url !== spec.url ||
  monitor.name !== spec.name ||
  pendingGroupKey !== null ||
  monitor.parentId !== spec.parentId

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

// Parents that still have a child after this run: everything under a group except the monitors
// this run deletes or moves elsewhere.
const survivingChildParents = (
  monitors: Monitor[],
  plan: Omit<ReconcilePlan, 'groups'>,
  onRemove: RemovalAction,
): Set<number> => {
  const leaving = new Set<number>([
    ...plan.update.map(({ monitor }) => monitor.id),
    ...(onRemove === 'delete' ? plan.retire.map((monitor) => monitor.id) : []),
  ])
  const parents = new Set<number>()
  for (const monitor of monitors) {
    if (monitor.parentId !== null && !leaving.has(monitor.id)) {
      parents.add(monitor.parentId)
    }
  }
  for (const { spec } of [...plan.update, ...plan.create]) {
    if (spec.parentId !== null) {
      parents.add(spec.parentId)
    }
  }
  return parents
}

export const buildPlan = (
  domains: DokployDomain[],
  monitors: Monitor[],
  options: PlanOptions,
): ReconcilePlan => {
  const managed = findManagedMonitors(monitors)
  const groups = findManagedGroups(monitors)
  const groupPlan = buildGroupPlan(
    domains,
    groups,
    options.isGrouped,
    options.settings.intervalSeconds,
  )

  const plan: Omit<ReconcilePlan, 'groups'> = {
    create: [],
    update: [],
    revive: [],
    retire: [],
    managedCount: managed.size,
    domainCount: domains.length,
  }

  const seen = new Set<string>()
  for (const domain of domains) {
    seen.add(domain.domainId)
    const planned = planMonitor(domain, options, groupPlan.existingIds)
    const monitor = managed.get(domain.domainId)

    if (!monitor) {
      plan.create.push(planned)
      continue
    }
    // A paused monitor whose domain is back in Dokploy has to be resumed, not just edited.
    if (!monitor.isActive) {
      plan.revive.push({ ...planned, monitor })
    }
    if (needsUpdate(monitor, planned)) {
      plan.update.push({ ...planned, monitor })
    }
  }

  for (const [domainId, monitor] of managed) {
    if (!seen.has(domainId) && monitor.isActive) {
      plan.retire.push(monitor)
    }
  }

  const wantedKeys = new Set(
    domains
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
        survivingChildParents(monitors, plan, options.onRemove),
      ),
    },
  }
}
