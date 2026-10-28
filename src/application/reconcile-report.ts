import type { ReconcilePlan } from '../domain/reconcile-plan.js'

export interface MonitorChangeDto {
  host: string | null
  name: string
  monitorId: number | null
}

export interface ReconcileReportDto {
  domainCount: number
  managedCount: number
  create: MonitorChangeDto[]
  update: MonitorChangeDto[]
  revive: MonitorChangeDto[]
  suspend: MonitorChangeDto[]
  retire: MonitorChangeDto[]
  expire: MonitorChangeDto[]
  stopped: { host: string; service: string | null }[]
  groups: { create: { name: string }[]; update: { name: string }[]; retire: { name: string }[] }
}

export const toReconcileReport = (plan: ReconcilePlan): ReconcileReportDto => ({
  domainCount: plan.domainCount,
  managedCount: plan.managedCount,
  create: plan.create.map(({ domain, spec }) => ({
    host: domain.host,
    name: spec.name,
    monitorId: null,
  })),
  update: plan.update.map(({ domain, spec, monitor }) => ({
    host: domain.host,
    name: spec.name,
    monitorId: monitor.id,
  })),
  revive: plan.revive.map(({ domain, spec, monitor }) => ({
    host: domain.host,
    name: spec.name,
    monitorId: monitor.id,
  })),
  suspend: plan.suspend.map(({ domain, spec, monitor }) => ({
    host: domain.host,
    name: spec.name,
    monitorId: monitor.id,
  })),
  retire: plan.retire.map((monitor) => ({ host: null, name: monitor.name, monitorId: monitor.id })),
  expire: plan.expire.map((monitor) => ({ host: null, name: monitor.name, monitorId: monitor.id })),
  stopped: plan.stopped.map((domain) => ({ host: domain.host, service: domain.serviceName })),
  groups: {
    create: plan.groups.create.map(({ spec }) => ({ name: spec.name })),
    update: plan.groups.update.map(({ spec }) => ({ name: spec.name })),
    retire: plan.groups.retire.map((group) => ({ name: group.name })),
  },
})

export const summariseReport = (report: ReconcileReportDto): string =>
  `created=${report.create.length} updated=${report.update.length} retired=${report.retire.length} managed=${report.managedCount}`
