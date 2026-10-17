import type { Monitor } from '../domain/monitor.js'
import type { Notification } from '../domain/notification.js'
import { isManaged } from '../domain/ownership.js'
import type { IMonitorReader, INotificationSource } from '../domain/ports.js'

export interface KumaInventoryDto {
  notifications: Notification[]
  monitorCount: number
  managedMonitors: Monitor[]
}

export const inspectKuma = async (
  monitors: IMonitorReader,
  notifications: INotificationSource,
): Promise<KumaInventoryDto> => {
  const [allMonitors, allNotifications] = await Promise.all([
    monitors.listMonitors(),
    notifications.listNotifications(),
  ])
  return {
    notifications: allNotifications,
    monitorCount: allMonitors.length,
    managedMonitors: allMonitors.filter(isManaged),
  }
}
