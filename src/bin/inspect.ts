/**
 * Logs in to Kuma and prints what it sees. Read-only: it sends `login` and reads the lists Kuma
 * pushes back, nothing else.
 *
 * Use it to find the notification ids for KUMA_NOTIFICATION_IDS — Kuma's UI never shows them — and to
 * confirm credentials and 2FA work before letting the reconciler run.
 */
import { loadConfig } from "../config.js";
import { MANAGED_MARKER_PREFIX } from "../constants.js";
import { KumaClient } from "../kuma.js";
import { createLogger } from "../logger.js";

const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  const kuma = new KumaClient(
    {
      url: config.KUMA_URL,
      username: config.KUMA_USERNAME,
      password: config.KUMA_PASSWORD,
      totpSecret: config.KUMA_TOTP_SECRET,
    },
    logger,
  );

  try {
    await kuma.connect();
    await kuma.login();
    logger.info("login ok");

    const notifications = await kuma.listNotifications();
    if (notifications.length === 0) {
      logger.warn(
        "Kuma has no notifications configured — monitors would be created but nothing would alert you",
      );
    }
    for (const notification of notifications) {
      logger.info(
        {
          id: notification.id,
          name: notification.name,
          active: notification.active,
        },
        "notification (use the id in KUMA_NOTIFICATION_IDS)",
      );
    }

    const monitors = await kuma.listMonitors();
    const managed = monitors.filter((monitor) =>
      (monitor.description ?? "").includes(MANAGED_MARKER_PREFIX),
    );
    logger.info(
      { total: monitors.length, managedByKumaSync: managed.length },
      "monitors in Kuma",
    );
    for (const monitor of managed) {
      logger.info(
        {
          id: monitor.id,
          name: monitor.name,
          url: monitor.url,
          active: monitor.active,
        },
        "managed monitor",
      );
    }
  } finally {
    kuma.close();
  }
};

main().catch((error: unknown) => {
  createLogger("error").fatal(
    { err: error instanceof Error ? error.message : String(error) },
    "inspect failed",
  );
  process.exitCode = 1;
});
