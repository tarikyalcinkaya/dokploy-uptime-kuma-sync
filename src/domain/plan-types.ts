import type { DokployDomain } from './dokploy-domain.js'
import type { GroupPlan } from './group-plan.js'
import type { HostRule } from './host-rule.js'
import type { Monitor, MonitorSettings, MonitorSpec } from './monitor.js'

export type RemovalAction = 'pause' | 'delete'

// Services whose root answers 401/404 by design need another URL or other codes to count as up.
export interface MonitorRules {
  healthPaths: HostRule<string>[]
  acceptedStatusCodes: HostRule<string[]>[]
}

export interface PlanOptions {
  settings: MonitorSettings
  // Environments other than a project's default one are usually staging; they need less attention.
  otherEnvironmentIntervalSeconds: number
  rules: MonitorRules
  isGrouped: boolean
  onRemove: RemovalAction
  // 0 keeps paused monitors forever.
  pausedRetentionDays: number
  now: Date
}

export interface PlannedMonitor {
  domain: DokployDomain
  spec: MonitorSpec
  // The group this run has yet to create; its id fills `spec.parentId` once it exists.
  pendingGroupKey: string | null
}

export interface PlannedChange extends PlannedMonitor {
  monitor: Monitor
}

export interface StampedMonitor {
  monitor: Monitor
  description: string
}

export interface ReconcilePlan {
  groups: GroupPlan
  create: PlannedMonitor[]
  update: PlannedChange[]
  revive: PlannedChange[]
  suspend: PlannedChange[]
  retire: Monitor[]
  stamp: StampedMonitor[]
  expire: Monitor[]
  stopped: DokployDomain[]
  managedCount: number
  domainCount: number
}
