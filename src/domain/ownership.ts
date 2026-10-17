import type { Monitor } from './monitor.js'

export const MANAGED_MARKER_PREFIX = 'dokploy:domainId='

export const GROUP_MARKER_PREFIX = 'dokploy:projectId='

export const PAUSED_MARKER_PREFIX = 'dokploy:pausedAt='

// Name-free on purpose: it is written into live monitor descriptions and must survive a rename.
const MANAGED_NOTICE = 'Managed automatically from Dokploy — do not edit manually.'

// Anchored to its own line, so a description that merely mentions the marker is not claimed.
const markerPattern = (prefix: string): RegExp => new RegExp(`^${prefix}([\\w-]+)$`, 'm')

const DOMAIN_MARKER = markerPattern(MANAGED_MARKER_PREFIX)

const GROUP_MARKER = markerPattern(GROUP_MARKER_PREFIX)

const PAUSED_MARKER = new RegExp(`^${PAUSED_MARKER_PREFIX}(\\S+)$`, 'm')

type Described = Pick<Monitor, 'description'>

export const readOwnedDomainId = (monitor: Described): string | null =>
  DOMAIN_MARKER.exec(monitor.description ?? '')?.[1] ?? null

export const readOwnedProjectId = (monitor: Described): string | null =>
  GROUP_MARKER.exec(monitor.description ?? '')?.[1] ?? null

export const isManaged = (monitor: Described): boolean =>
  readOwnedDomainId(monitor) !== null || readOwnedProjectId(monitor) !== null

// Kuma keeps no record of when a monitor was paused, so the time travels in the description.
export const readPausedAt = (monitor: Described): Date | null => {
  const stamp = PAUSED_MARKER.exec(monitor.description ?? '')?.[1]
  const pausedAt = stamp ? new Date(stamp) : null
  return pausedAt && !Number.isNaN(pausedAt.getTime()) ? pausedAt : null
}

export const describeOwnership = (domainId: string, pausedAt: Date | null = null): string =>
  [
    MANAGED_NOTICE,
    `${MANAGED_MARKER_PREFIX}${domainId}`,
    ...(pausedAt ? [`${PAUSED_MARKER_PREFIX}${pausedAt.toISOString()}`] : []),
  ].join('\n')

export const describeGroupOwnership = (projectId: string): string =>
  `${MANAGED_NOTICE}\n${GROUP_MARKER_PREFIX}${projectId}`
