import type { DokployDomain } from './dokploy-domain.js'
import type { Monitor, MonitorSpec } from './monitor.js'
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

export interface INotificationSource {
  listNotifications(): Promise<Notification[]>
}
