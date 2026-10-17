import { toMonitorName, toMonitorUrl } from '../domain/dokploy-domain.js'
import type { IDomainSource } from '../domain/ports.js'

export interface ManagedDomainDto {
  domainId: string
  domainType: string | null
  url: string
  monitorName: string
}

export const listManagedDomains = async (source: IDomainSource): Promise<ManagedDomainDto[]> => {
  const domains = await source.listDomains()
  return domains.map((domain) => ({
    domainId: domain.domainId,
    domainType: domain.domainType,
    url: toMonitorUrl(domain),
    monitorName: toMonitorName(domain),
  }))
}
