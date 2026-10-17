export interface Monitor {
  id: number
  name: string
  url: string | null
  isGroup: boolean
  parentId: number | null
  isActive: boolean
  description: string | null
  acceptedStatusCodes: string[]
  settings: MonitorSettings
}

export interface MonitorSettings {
  intervalSeconds: number
  retries: number
  timeoutSeconds: number
  notificationIds: string[]
  notifiesCertificateExpiry: boolean
}

export const DEFAULT_ACCEPTED_STATUS_CODES = ['200-299']

export interface MonitorSpec {
  name: string
  url: string
  description: string
  parentId: number | null
  acceptedStatusCodes: string[]
  settings: MonitorSettings
}

export interface GroupSpec {
  name: string
  description: string
  intervalSeconds: number
}
