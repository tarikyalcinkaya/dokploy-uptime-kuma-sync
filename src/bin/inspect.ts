// Read-only: logs in to Kuma and prints the lists it pushes back. Use it to find the ids for
// KUMA_NOTIFICATION_IDS and to confirm credentials and 2FA before letting the reconciler run.
import { inspectKuma } from '../application/inspect-kuma.js'
import { loadKumaConfig } from '../infrastructure/config.js'
import { KumaMonitorReader, KumaNotificationSource } from '../infrastructure/kuma/kuma-monitors.js'
import { KumaSession } from '../infrastructure/kuma/kuma-session.js'
import { createLogger } from '../infrastructure/logger.js'
import { errorMessage } from '../shared/errors.js'

const main = async (): Promise<void> => {
  const config = loadKumaConfig()
  const logger = createLogger(config.LOG_LEVEL, config.LOG_FORMAT)

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
    await session.open()
    logger.info('login ok')

    const inventory = await inspectKuma(
      new KumaMonitorReader(session),
      new KumaNotificationSource(session),
    )

    if (inventory.notifications.length === 0) {
      logger.warn(
        'Kuma has no notifications configured — monitors would be created but nothing would alert you',
      )
    }
    for (const notification of inventory.notifications) {
      logger.info(notification, 'notification (use the id in KUMA_NOTIFICATION_IDS)')
    }

    logger.info(
      { total: inventory.monitorCount, managed: inventory.managedMonitors.length },
      'monitors in Kuma',
    )
    for (const monitor of inventory.managedMonitors) {
      logger.info(
        { id: monitor.id, name: monitor.name, url: monitor.url, isActive: monitor.isActive },
        'managed monitor',
      )
    }
  } finally {
    session.close()
  }
}

main().catch((error: unknown) => {
  createLogger('error').fatal({ err: errorMessage(error) }, 'inspect failed')
  process.exitCode = 1
})
