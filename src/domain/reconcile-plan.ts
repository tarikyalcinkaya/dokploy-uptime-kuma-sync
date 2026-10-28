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
import { describeOwnership, readOwnedDomainId, readPausedAt } from './ownership.js'

export type RemovalAction = 'pause' | 'delete'

// Services whose root answers 401/404 by design need another URL or other codes to count as up.
export interface MonitorRules {
  healthPaths: HostRule<string>[]
  acceptedStatusCodes: HostRule<string[]>[]
}

export interface PlanOptions {
  settings: MonitorSettings
  // Environments other than a project's default one are usually staging; they need less attention.
  otherEnvironmentIntervalSeconds: number
  rules: MonitorRules
  isGrouped: boolean
  onRemove: RemovalAction
  // 0 keeps paused monitors forever.
  pausedRetentionDays: number
  now: Date
}

export interface PlannedMonitor {
  domain: DokployDomain
  spec: MonitorSpec
  // The group this run has yet to create; its id fills `spec.parentId` once it exists.
  pendingGroupKey: string | null
}

export interface PlannedChange extends PlannedMonitor {
  monitor: Monitor
}

export interface StampedMonitor {
  monitor: Monitor
  description: string
}

export interface ReconcilePlan {
  groups: GroupPlan
  create: PlannedMonitor[]
  update: PlannedChange[]
  revive: PlannedChange[]
  suspend: PlannedChange[]
  retire: Monitor[]
  stamp: StampedMonitor[]
  expire: Monitor[]
  stopped: DokployDomain[]
  managedCount: number
  domainCount: number
}

const endpointOf = (domain: DokployDomain, rules: MonitorRules): string =>
  toMonitorUrl(domain, findHostRule(rules.healthPaths, domain.host))
    .replace(/^https?:\/\//, '')
    .toLowerCase()

// The row that already has a monitor wins so its history stays put; https breaks the remaining ties.
const uniqueEndpoints = (
  domains: DokployDomain[],
  rules: MonitorRules,
  ownedDomainIds: ReadonlySet<string>,
): DokployDomain[] => {
  const rank = (domain: DokployDomain): number =>
    (ownedDomainIds.has(domain.domainId) ? 2 : 0) + (domain.isHttps ? 1 : 0)
  const byEndpoint = new Map<string, DokployDomain>()
  for (const domain of domains) {
    const key = endpointOf(domain, rules)
    const kept = byEndpoint.get(key)
    if (!kept || rank(domain) > rank(kept)) {
      byEndpoint.set(key, domain)
    }
  }
  return [...byEndpoint.values()]
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

const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((item) => right.includes(item))

const sameSettings = (current: MonitorSettings, wanted: MonitorSettings): boolean =>
  current.intervalSeconds === wanted.intervalSeconds &&
  current.retries === wanted.retries &&
  current.timeoutSeconds === wanted.timeoutSeconds &&
  current.notifiesCertificateExpiry === wanted.notifiesCertificateExpiry &&
  sameSet(current.notificationIds, wanted.notificationIds)

const MILLISECONDS_PER_DAY = 86_400_000

const needsUpdate = (monitor: Monitor, { spec, pendingGroupKey }: PlannedMonitor): boolean =>
  monitor.url !== spec.url ||
  monitor.description !== spec.description ||
  monitor.name !== spec.name ||
  pendingGroupKey !== null ||
  monitor.parentId !== spec.parentId ||
  !sameSet(monitor.acceptedStatusCodes, spec.acceptedStatusCodes) ||
  !sameSettings(monitor.settings, spec.settings)

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

// A group survives while anything stays under it that this run neither deletes nor moves.
const survivingChildParents = (
  monitors: Monitor[],
  plan: Omit<ReconcilePlan, 'groups'>,
  onRemove: RemovalAction,
): Set<number> => {
  const leaving = new Set<number>([
    ...plan.update.map(({ monitor }) => monitor.id),
    ...(onRemove === 'delete' ? plan.retire.map((monitor) => monitor.id) : []),
    ...plan.expire.map((monitor) => monitor.id),
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
  allDomains: DokployDomain[],
  monitors: Monitor[],
  options: PlanOptions,
): ReconcilePlan => {
  const managed = findManagedMonitors(monitors)
  const domains = uniqueEndpoints(allDomains, options.rules, new Set(managed.keys()))
  const groups = findManagedGroups(monitors)
  const watched = domains.filter((domain) => !domain.isStopped || managed.has(domain.domainId))
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
        survivingChildParents(monitors, plan, options.onRemove),
      ),
    },
  }
}
