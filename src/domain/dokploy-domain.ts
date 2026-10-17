export interface DokployDomain {
  domainId: string
  host: string
  isHttps: boolean
  path: string | null
  domainType: string | null
  serviceName: string | null
  environmentName: string | null
  isDefaultEnvironment: boolean | null
  projectId: string | null
  projectName: string | null
}

// Dokploy's `port` column is the container port, not the public one, so it never enters the URL.
// A health path replaces the domain's own path: it is written from the host root.
export const toMonitorUrl = (domain: DokployDomain, healthPath: string | null = null): string => {
  const scheme = domain.isHttps ? 'https' : 'http'
  const ownPath = domain.path && domain.path !== '/' ? domain.path : ''
  const path = healthPath ?? ownPath
  const normalisedPath = path.length > 0 && !path.startsWith('/') ? `/${path}` : path
  return `${scheme}://${domain.host}${normalisedPath}`
}

// Dokploy creates a default environment with every project, so naming it would be pure noise.
const distinctiveEnvironment = (domain: DokployDomain): string | null =>
  domain.isDefaultEnvironment === false ? domain.environmentName : null

const joinName = (parts: (string | null)[], host: string): string => {
  const context = parts.filter((part): part is string => Boolean(part))
  return [...context, host].join(' · ')
}

// Inside a project group the project is already on screen, so the child names only what differs.
export const toMonitorName = (domain: DokployDomain, isGrouped: boolean): string =>
  isGrouped
    ? joinName([domain.serviceName, distinctiveEnvironment(domain)], domain.host)
    : joinName(
        [domain.projectName, domain.serviceName, distinctiveEnvironment(domain)],
        domain.host,
      )

export const toGroupName = (domain: DokployDomain): string =>
  domain.projectName ?? domain.projectId ?? 'Dokploy'
