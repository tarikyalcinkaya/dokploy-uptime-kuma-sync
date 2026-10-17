export interface Monitor {
  id: number
  name: string
  url: string | null
  isActive: boolean
  description: string | null
}

export interface MonitorSettings {
  intervalSeconds: number
  retries: number
  timeoutSeconds: number
  notificationIds: string[]
}

export interface MonitorSpec {
  name: string
  url: string
  description: string
  settings: MonitorSettings
}
