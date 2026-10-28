import {
  type DokployDomain,
  toGroupName,
  toMonitorName,
  toMonitorUrl,
} from '../domain/dokploy-domain.js'
import { isWatched, uniqueEndpoints } from '../domain/endpoint.js'
import { type Exclusions, isExcluded } from '../domain/exclusion.js'
import { findHostRule, type HostRule } from '../domain/host-rule.js'
import type { IDomainSource } from '../domain/ports.js'

export interface ManagedDomainDto {
  domainId: string
  domainType: string | null
  url: string
  group: string | null
  monitorName: string
  isExcluded: boolean
}

// The set reconcile would plan for. Kuma is not consulted, so no monitor exists yet to keep a stopped service listed.
const selectWatched = (
  domains: DokployDomain[],
  healthPaths: HostRule<string>[],
  exclusions: Exclusions,
): DokployDomain[] => {
  const none: ReadonlySet<string> = new Set()
  return uniqueEndpoints(
    domains.filter((domain) => !isExcluded(domain, exclusions)),
    healthPaths,
    none,
  ).filter((domain) => isWatched(domain, none))
}

export const listManagedDomains = async (
  source: IDomainSource,
  isGrouped: boolean,
  healthPaths: HostRule<string>[],
  exclusions: Exclusions,
  watchedOnly = false,
): Promise<ManagedDomainDto[]> => {
  const all = await source.listDomains()
  const domains = watchedOnly ? selectWatched(all, healthPaths, exclusions) : all
  return domains.map((domain) => ({
    domainId: domain.domainId,
    domainType: domain.domainType,
    url: toMonitorUrl(domain, findHostRule(healthPaths, domain.host)),
    group: isGrouped ? toGroupName(domain) : null,
    monitorName: toMonitorName(domain, isGrouped),
    isExcluded: isExcluded(domain, exclusions),
  }))
}
