import type { Monitor } from './monitor.js'

export const MANAGED_MARKER_PREFIX = 'dokploy:domainId='

// Name-free on purpose: it is written into live monitor descriptions and must survive a rename.
const MANAGED_NOTICE = 'Managed automatically from Dokploy — do not edit manually.'

const MARKER_PATTERN = new RegExp(`${MANAGED_MARKER_PREFIX}([\\w-]+)`)

export const readOwnedDomainId = (monitor: Pick<Monitor, 'description'>): string | null =>
  MARKER_PATTERN.exec(monitor.description ?? '')?.[1] ?? null

export const isManaged = (monitor: Pick<Monitor, 'description'>): boolean =>
  readOwnedDomainId(monitor) !== null

export const describeOwnership = (domainId: string): string =>
  `${MANAGED_NOTICE}\n${MANAGED_MARKER_PREFIX}${domainId}`
