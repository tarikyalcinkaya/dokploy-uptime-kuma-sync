import { type DokployDomain, toMonitorUrl } from './dokploy-domain.js'
import { findHostRule } from './host-rule.js'
import type { MonitorRules } from './plan-types.js'

const endpointOf = (domain: DokployDomain, rules: MonitorRules): string =>
  toMonitorUrl(domain, findHostRule(rules.healthPaths, domain.host))
    .replace(/^https?:\/\//, '')
    .toLowerCase()

// The row that already has a monitor wins so its history stays put; https breaks the remaining ties.
export const uniqueEndpoints = (
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
