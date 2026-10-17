export interface DokployDomain {
  domainId: string
  host: string
  isHttps: boolean
  path: string | null
  domainType: string | null
  serviceName: string | null
  environmentName: string | null
  projectName: string | null
}

// Dokploy's `port` column is the container port, not the public one, so it never enters the URL.
export const toMonitorUrl = (domain: DokployDomain): string => {
  const scheme = domain.isHttps ? 'https' : 'http'
  const path = domain.path && domain.path !== '/' ? domain.path : ''
  const normalisedPath = path.length > 0 && !path.startsWith('/') ? `/${path}` : path
  return `${scheme}://${domain.host}${normalisedPath}`
}

export const toMonitorName = (domain: DokployDomain): string => {
  const context = [domain.projectName, domain.serviceName]
    .filter((part): part is string => Boolean(part))
    .join('/')
  return context.length > 0 ? `${context} · ${domain.host}` : domain.host
}
