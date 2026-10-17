import type { DokployDomain } from './dokploy-domain.js'
import type { GroupSpec, Monitor, MonitorSpec } from './monitor.js'
import type { Notification } from './notification.js'

export interface IDomainSource {
  listDomains(): Promise<DokployDomain[]>
}

export interface IMonitorReader {
  listMonitors(): Promise<Monitor[]>
}

export interface IMonitorWriter {
  createMonitor(spec: MonitorSpec): Promise<number>
  updateMonitor(id: number, spec: MonitorSpec): Promise<void>
  pauseMonitor(id: number): Promise<void>
  resumeMonitor(id: number): Promise<void>
  deleteMonitor(id: number): Promise<void>
}

export interface IGroupWriter {
  createGroup(spec: GroupSpec): Promise<number>
  updateGroup(id: number, spec: GroupSpec): Promise<void>
  deleteGroup(id: number): Promise<void>
}

export interface INotificationSource {
  listNotifications(): Promise<Notification[]>
}
