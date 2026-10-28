import { isManaged } from '../domain/ownership.js'
import type { IMonitorReader, INotificationSource } from '../domain/ports.js'

export interface NotificationDto {
  id: number
  name: string
  isActive: boolean
}

export interface ManagedMonitorDto {
  id: number
  name: string
  url: string | null
  isActive: boolean
}

export interface KumaInventoryDto {
  notifications: NotificationDto[]
  monitorCount: number
  managedMonitors: ManagedMonitorDto[]
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
    notifications: allNotifications.map(({ id, name, isActive }) => ({ id, name, isActive })),
    monitorCount: allMonitors.length,
    managedMonitors: allMonitors
      .filter(isManaged)
      .map(({ id, name, url, isActive }) => ({ id, name, url, isActive })),
  }
}
