import { toGroupName, toMonitorName, toMonitorUrl } from '../domain/dokploy-domain.js'
import { findHostRule, type HostRule } from '../domain/host-rule.js'
import type { IDomainSource } from '../domain/ports.js'

export interface ManagedDomainDto {
  domainId: string
  domainType: string | null
  url: string
  group: string | null
  monitorName: string
}

export const listManagedDomains = async (
  source: IDomainSource,
  isGrouped: boolean,
  healthPaths: HostRule<string>[],
): Promise<ManagedDomainDto[]> => {
  const domains = await source.listDomains()
  return domains.map((domain) => ({
    domainId: domain.domainId,
    domainType: domain.domainType,
    url: toMonitorUrl(domain, findHostRule(healthPaths, domain.host)),
    group: isGrouped ? toGroupName(domain) : null,
    monitorName: toMonitorName(domain, isGrouped),
  }))
}
