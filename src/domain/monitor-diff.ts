import type { Monitor, MonitorSettings } from './monitor.js'
import type { PlannedMonitor } from './plan-types.js'

const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((item) => right.includes(item))

const sameSettings = (current: MonitorSettings, wanted: MonitorSettings): boolean =>
  current.intervalSeconds === wanted.intervalSeconds &&
  current.retries === wanted.retries &&
  current.timeoutSeconds === wanted.timeoutSeconds &&
  current.notifiesCertificateExpiry === wanted.notifiesCertificateExpiry &&
  sameSet(current.notificationIds, wanted.notificationIds)

export const needsUpdate = (monitor: Monitor, { spec, pendingGroupKey }: PlannedMonitor): boolean =>
  monitor.url !== spec.url ||
  monitor.description !== spec.description ||
  monitor.name !== spec.name ||
  pendingGroupKey !== null ||
  monitor.parentId !== spec.parentId ||
  !sameSet(monitor.acceptedStatusCodes, spec.acceptedStatusCodes) ||
  !sameSettings(monitor.settings, spec.settings)
