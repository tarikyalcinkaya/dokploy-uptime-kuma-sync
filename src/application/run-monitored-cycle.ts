import { errorMessage } from '../shared/errors.js'
import type { IHeartbeatSink } from '../domain/ports.js'
import type { ILogger } from './logger.js'
import { type ReconcileReportDto, summariseReport } from './reconcile-report.js'

export interface MonitoredCycleDeps {
  heartbeat: IHeartbeatSink
  logger: ILogger
  clock?: () => number
}

// A dry run applies nothing, so reporting it healthy would keep a forgotten DRY_RUN green forever.
export const runMonitoredCycle = async (
  isDryRun: boolean,
  deps: MonitoredCycleDeps,
  work: () => Promise<ReconcileReportDto>,
): Promise<ReconcileReportDto> => {
  const { heartbeat, logger, clock = () => performance.now() } = deps
  if (isDryRun && heartbeat.isConfigured) {
    logger.debug('dry run — heartbeat skipped')
  }
  const shouldReport = !isDryRun
  const startedAt = clock()

  try {
    const result = await work()
    if (shouldReport) {
      await heartbeat.send({
        status: 'up',
        message: summariseReport(result),
        durationMs: clock() - startedAt,
      })
    }
    return result
  } catch (error) {
    // Reporting actively beats waiting for Kuma's push timeout, which still covers a Kuma outage.
    if (shouldReport) {
      await heartbeat.send({
        status: 'down',
        message: errorMessage(error),
        durationMs: clock() - startedAt,
      })
    }
    throw error
  }
}
