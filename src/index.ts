import type { ILogger } from './application/logger.js'
import { runMonitoredCycle } from './application/run-monitored-cycle.js'
import { reconcileMonitors, type ReconcileMonitorsInput } from './application/reconcile-monitors.js'
import { type Config, loadConfig, toExclusions } from './infrastructure/config.js'
import { closeDokploy, connectDokploy } from './infrastructure/dokploy/postgres-client.js'
import { PostgresDomainSource } from './infrastructure/dokploy/postgres-domain-source.js'
import { PushHeartbeatSink } from './infrastructure/heartbeat.js'
import { markAlive } from './infrastructure/liveness.js'
import {
  KumaGroupWriter,
  KumaMonitorLifecycle,
  KumaMonitorReader,
  KumaMonitorWriter,
} from './infrastructure/kuma/kuma-monitors.js'
import { KumaSession } from './infrastructure/kuma/kuma-session.js'
import { createLogger } from './infrastructure/logger.js'
import { errorMessage } from './shared/errors.js'

const MILLISECONDS_PER_SECOND = 1000

const sleep = (seconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, seconds * MILLISECONDS_PER_SECOND)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

const toReconcileInput = (config: Config): ReconcileMonitorsInput => ({
  isDryRun: config.DRY_RUN,
  onRemove: config.ON_REMOVE,
  maxRetireRatio: config.MAX_RETIRE_RATIO,
  isGrouped: config.GROUP_BY_PROJECT,
  otherEnvironmentIntervalSeconds: config.MONITOR_INTERVAL_SECONDS_OTHER_ENVS,
  rules: { healthPaths: config.HEALTH_PATHS, acceptedStatusCodes: config.ACCEPTED_STATUS_CODES },
  exclusions: toExclusions(config),
  pausedRetentionDays: config.PAUSED_DELETE_AFTER_DAYS,
  monitorSettings: {
    intervalSeconds: config.MONITOR_INTERVAL_SECONDS,
    retries: config.MONITOR_RETRIES,
    timeoutSeconds: config.MONITOR_TIMEOUT_SECONDS,
    notifiesCertificateExpiry: config.MONITOR_EXPIRY_NOTIFICATION,
    notificationIds: config.KUMA_NOTIFICATION_IDS,
  },
})

// Kuma pushes the monitor list once per session, so a fresh connection per cycle is what keeps
// the view current — cheaper than tracking incremental updates and impossible to get stale.
const cycle = async (config: Config, logger: ILogger): Promise<void> => {
  const session = new KumaSession(
    {
      url: config.KUMA_URL,
      username: config.KUMA_USERNAME,
      password: config.KUMA_PASSWORD,
      totpSecret: config.KUMA_TOTP_SECRET,
    },
    logger,
  )

  try {
    await runMonitoredCycle(
      config.DRY_RUN,
      { heartbeat: new PushHeartbeatSink(config.KUMA_PUSH_URL, logger), logger },
      async () => {
        await session.open()
        const sql = connectDokploy(config.DATABASE_URL)
        try {
          return await reconcileMonitors(toReconcileInput(config), {
            domains: new PostgresDomainSource(sql),
            monitorReader: new KumaMonitorReader(session),
            monitorWriter: new KumaMonitorWriter(session),
            monitorLifecycle: new KumaMonitorLifecycle(session),
            groupWriter: new KumaGroupWriter(session),
            logger,
          })
        } finally {
          await closeDokploy(sql)
        }
      },
    )
  } finally {
    session.close()
  }
}

const main = async (): Promise<void> => {
  const config = loadConfig()
  const logger = createLogger(config.LOG_LEVEL, config.LOG_FORMAT)

  logger.info(
    {
      mode: config.RUN_MODE,
      dryRun: config.DRY_RUN,
      onRemove: config.ON_REMOVE,
      kuma: config.KUMA_URL,
    },
    'dokploy-uptime-kuma-sync starting',
  )

  if (config.RUN_MODE === 'once') {
    await cycle(config, logger)
    return
  }

  const controller = new AbortController()
  const stop = (signal: string) => {
    logger.info({ signal }, 'shutting down after current cycle')
    controller.abort()
  }
  process.once('SIGINT', () => stop('SIGINT'))
  process.once('SIGTERM', () => stop('SIGTERM'))

  const reportAlive = () =>
    markAlive(config.ALIVE_FILE).catch((error: unknown) => {
      logger.warn({ err: errorMessage(error) }, 'could not write the liveness file')
    })
  await reportAlive()

  while (!controller.signal.aborted) {
    try {
      await cycle(config, logger)
    } catch (error) {
      // Kuma or Postgres being briefly unreachable is expected; the next cycle starts from scratch.
      logger.error({ err: errorMessage(error) }, 'cycle failed')
    }
    await reportAlive()

    if (controller.signal.aborted) {
      break
    }
    await sleep(config.INTERVAL_SECONDS, controller.signal)
  }
}

main().catch((error: unknown) => {
  createLogger('error').fatal(
    { err: errorMessage(error) },
    'dokploy-uptime-kuma-sync failed to start',
  )
  process.exitCode = 1
})
