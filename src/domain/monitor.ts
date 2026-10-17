export interface Monitor {
  id: number
  name: string
  url: string | null
  isGroup: boolean
  parentId: number | null
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
  parentId: number | null
  settings: MonitorSettings
}

export interface GroupSpec {
  name: string
  description: string
  intervalSeconds: number
}
