import type { DokployDomain } from './dokploy-domain.js'
import { matchesPattern } from './host-rule.js'

export interface Exclusions {
  hosts: string[]
  projects: string[]
  services: string[]
  middlewares: string[]
}

const anyMatch = (patterns: readonly string[], value: string | null): boolean =>
  value !== null && patterns.some((pattern) => matchesPattern(pattern, value))

// A VPN-only service is unreachable from Kuma by design; monitoring it would only ever alert.
export const isExcluded = (domain: DokployDomain, exclusions: Exclusions): boolean =>
  anyMatch(exclusions.hosts, domain.host) ||
  anyMatch(exclusions.projects, domain.projectName) ||
  anyMatch(exclusions.services, domain.serviceName) ||
  domain.middlewares.some((middleware) => anyMatch(exclusions.middlewares, middleware))
