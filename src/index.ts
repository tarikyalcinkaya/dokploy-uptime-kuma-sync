import type { ILogger } from './application/logger.js'
import { reconcileMonitors, type ReconcileMonitorsInput } from './application/reconcile-monitors.js'
import { type Config, loadConfig, toExclusions } from './infrastructure/config.js'
import { PostgresDomainSource } from './infrastructure/dokploy/postgres-domain-source.js'
import { sendHeartbeat } from './infrastructure/heartbeat.js'
import {
  KumaGroupWriter,
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

  // A dry run applies nothing, so reporting it healthy would keep a forgotten DRY_RUN green forever.
  const pushUrl = config.DRY_RUN ? undefined : config.KUMA_PUSH_URL
  if (config.DRY_RUN && config.KUMA_PUSH_URL) {
    logger.debug('dry run — heartbeat skipped')
  }
  const startedAt = performance.now()

  try {
    await session.open()
    const plan = await reconcileMonitors(toReconcileInput(config), {
      domains: new PostgresDomainSource(config.DATABASE_URL),
      monitorReader: new KumaMonitorReader(session),
      monitorWriter: new KumaMonitorWriter(session),
      groupWriter: new KumaGroupWriter(session),
      logger,
    })

    await sendHeartbeat(
      pushUrl,
      {
        status: 'up',
        message: `created=${plan.create.length} updated=${plan.update.length} retired=${plan.retire.length} managed=${plan.managedCount}`,
        durationMs: performance.now() - startedAt,
      },
      logger,
    )
  } catch (error) {
    // Report actively instead of waiting for Kuma's push timeout; if Kuma itself is down the
    // ping fails too and the timeout covers us.
    await sendHeartbeat(
      pushUrl,
      { status: 'down', message: errorMessage(error), durationMs: performance.now() - startedAt },
      logger,
    )
    throw error
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

  while (!controller.signal.aborted) {
    try {
      await cycle(config, logger)
    } catch (error) {
      // Kuma or Postgres being briefly unreachable is expected; the next cycle starts from scratch.
      logger.error({ err: errorMessage(error) }, 'cycle failed')
    }

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
