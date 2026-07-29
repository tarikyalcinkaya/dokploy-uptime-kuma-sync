import { loadConfig } from "./config.js";
import { sendHeartbeat } from "./heartbeat.js";
import { KumaClient } from "./kuma.js";
import { createLogger, type Logger } from "./logger.js";
import { runOnce } from "./reconcile.js";

const MILLISECONDS_PER_SECOND = 1000;

const sleep = (seconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, seconds * MILLISECONDS_PER_SECOND);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * One full cycle owns its own Kuma connection. Kuma pushes the monitor list once per session, so
 * reconnecting each cycle is what keeps the view fresh — cheaper than tracking incremental
 * `updateMonitorIntoList` events and impossible to get subtly stale.
 */
const cycle = async (
  config: ReturnType<typeof loadConfig>,
  logger: Logger,
): Promise<void> => {
  const kuma = new KumaClient(
    {
      url: config.KUMA_URL,
      username: config.KUMA_USERNAME,
      password: config.KUMA_PASSWORD,
      totpSecret: config.KUMA_TOTP_SECRET,
    },
    logger,
  );

  // A dry run proves nothing was applied, so it must not report the sync as healthy — otherwise
  // leaving DRY_RUN on forever would look green while no monitor is ever created.
  const pushUrl = config.DRY_RUN ? undefined : config.KUMA_PUSH_URL;
  if (config.DRY_RUN && config.KUMA_PUSH_URL) {
    logger.debug("dry run — heartbeat skipped");
  }
  const startedAt = performance.now();

  try {
    await kuma.connect();
    await kuma.login();
    const plan = await runOnce(config, kuma, logger);

    await sendHeartbeat(
      pushUrl,
      {
        status: "up",
        message: `created=${plan.create.length} updated=${plan.update.length} retired=${plan.retire.length} managed=${plan.managedCount}`,
        durationMs: performance.now() - startedAt,
      },
      logger,
    );
  } catch (error) {
    // Report the failure actively rather than waiting for Kuma's push timeout. If Kuma itself is
    // what is unreachable, this ping fails too and the timeout covers us.
    await sendHeartbeat(
      pushUrl,
      {
        status: "down",
        message: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - startedAt,
      },
      logger,
    );
    throw error;
  } finally {
    kuma.close();
  }
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  logger.info(
    {
      mode: config.RUN_MODE,
      dryRun: config.DRY_RUN,
      onRemove: config.ON_REMOVE,
      kuma: config.KUMA_URL,
    },
    "kuma-sync starting",
  );

  if (config.RUN_MODE === "once") {
    await cycle(config, logger);
    return;
  }

  const controller = new AbortController();
  const stop = (signal: string) => {
    logger.info({ signal }, "shutting down after current cycle");
    controller.abort();
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  while (!controller.signal.aborted) {
    try {
      await cycle(config, logger);
    } catch (error) {
      // A failed cycle must not kill the loop: Kuma or Postgres being briefly unreachable is
      // expected, and the next cycle reconciles from scratch anyway.
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "cycle failed",
      );
    }

    if (controller.signal.aborted) {
      break;
    }
    await sleep(config.INTERVAL_SECONDS, controller.signal);
  }
};

main().catch((error: unknown) => {
  const logger = createLogger("error");
  logger.fatal(
    { err: error instanceof Error ? error.message : String(error) },
    "kuma-sync failed to start",
  );
  process.exitCode = 1;
});
