import { type DokployDomain, toMonitorUrl } from './dokploy-domain.js'
import { findHostRule, type HostRule } from './host-rule.js'

const endpointOf = (domain: DokployDomain, healthPaths: HostRule<string>[]): string =>
  toMonitorUrl(domain, findHostRule(healthPaths, domain.host))
    .replace(/^https?:\/\//, '')
    .toLowerCase()

// The row that already has a monitor wins so its history stays put; https breaks the remaining ties.
export const uniqueEndpoints = (
  domains: DokployDomain[],
  healthPaths: HostRule<string>[],
  ownedDomainIds: ReadonlySet<string>,
): DokployDomain[] => {
  const rank = (domain: DokployDomain): number =>
    (ownedDomainIds.has(domain.domainId) ? 2 : 0) + (domain.isHttps ? 1 : 0)
  const byEndpoint = new Map<string, DokployDomain>()
  for (const domain of domains) {
    const key = endpointOf(domain, healthPaths)
    const kept = byEndpoint.get(key)
    if (!kept || rank(domain) > rank(kept)) {
      byEndpoint.set(key, domain)
    }
  }
  return [...byEndpoint.values()]
}

// A stopped service stays watched only while its monitor exists, so it can be paused rather than lost.
export const isWatched = (domain: DokployDomain, ownedDomainIds: ReadonlySet<string>): boolean =>
  !domain.isStopped || ownedDomainIds.has(domain.domainId)
