import { type DokployDomain, toMonitorName, toMonitorUrl } from './dokploy-domain.js'
import type { Monitor, MonitorSettings, MonitorSpec } from './monitor.js'
import { describeOwnership, readOwnedDomainId } from './ownership.js'

export interface PlannedMonitor {
  domain: DokployDomain
  spec: MonitorSpec
}

export interface PlannedChange extends PlannedMonitor {
  monitor: Monitor
}

export interface ReconcilePlan {
  create: PlannedMonitor[]
  update: PlannedChange[]
  revive: PlannedChange[]
  retire: Monitor[]
  managedCount: number
  domainCount: number
}

export const toMonitorSpec = (domain: DokployDomain, settings: MonitorSettings): MonitorSpec => ({
  name: toMonitorName(domain),
  url: toMonitorUrl(domain),
  description: describeOwnership(domain.domainId),
  settings,
})

const needsUpdate = (monitor: Monitor, spec: MonitorSpec): boolean =>
  monitor.url !== spec.url || monitor.name !== spec.name

export const buildPlan = (
  domains: DokployDomain[],
  monitors: Monitor[],
  settings: MonitorSettings,
): ReconcilePlan => {
  const managed = new Map<string, Monitor>()
  for (const monitor of monitors) {
    const domainId = readOwnedDomainId(monitor)
    if (domainId) {
      managed.set(domainId, monitor)
    }
  }

  const plan: ReconcilePlan = {
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
    const spec = toMonitorSpec(domain, settings)
    const monitor = managed.get(domain.domainId)

    if (!monitor) {
      plan.create.push({ domain, spec })
      continue
    }
    // A paused monitor whose domain is back in Dokploy has to be resumed, not just edited.
    if (!monitor.isActive) {
      plan.revive.push({ monitor, domain, spec })
    }
    if (needsUpdate(monitor, spec)) {
      plan.update.push({ monitor, domain, spec })
    }
  }

  for (const [domainId, monitor] of managed) {
    if (!seen.has(domainId) && monitor.isActive) {
      plan.retire.push(monitor)
    }
  }

  return plan
}
