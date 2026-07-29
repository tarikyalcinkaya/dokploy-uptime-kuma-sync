import type { Config } from "./config.js";
import {
  MANAGED_MARKER_PREFIX,
  MANAGED_NOTICE,
  MIN_RETIRE_ALLOWANCE,
  MONITOR_DEFAULTS,
} from "./constants.js";
import {
  type DokployDomain,
  domainToMonitorName,
  domainToUrl,
  fetchDokployDomains,
} from "./dokploy.js";
import type { KumaClient, KumaMonitor } from "./kuma.js";
import type { Logger } from "./logger.js";

const MARKER_PATTERN = new RegExp(`${MANAGED_MARKER_PREFIX}([\\w-]+)`);

const readDomainId = (monitor: KumaMonitor): string | null =>
  MARKER_PATTERN.exec(monitor.description ?? "")?.[1] ?? null;

const buildDescription = (domain: DokployDomain): string =>
  `${MANAGED_NOTICE}\n${MANAGED_MARKER_PREFIX}${domain.domainId}`;

const buildNotificationList = (ids: string[]): Record<string, boolean> =>
  Object.fromEntries(ids.map((id) => [id, true]));

const buildMonitorPayload = (
  domain: DokployDomain,
  config: Config,
): Record<string, unknown> => ({
  ...MONITOR_DEFAULTS,
  name: domainToMonitorName(domain),
  url: domainToUrl(domain),
  interval: config.MONITOR_INTERVAL_SECONDS,
  retryInterval: config.MONITOR_INTERVAL_SECONDS,
  maxretries: config.MONITOR_RETRIES,
  timeout: config.MONITOR_TIMEOUT_SECONDS,
  description: buildDescription(domain),
  notificationIDList: buildNotificationList(config.KUMA_NOTIFICATION_IDS),
  active: true,
});

export interface ReconcilePlan {
  create: DokployDomain[];
  update: { monitor: KumaMonitor; domain: DokployDomain }[];
  retire: KumaMonitor[];
  revive: { monitor: KumaMonitor; domain: DokployDomain }[];
  managedCount: number;
  domainCount: number;
}

export const buildPlan = (
  domains: DokployDomain[],
  monitors: KumaMonitor[],
): ReconcilePlan => {
  const managed = new Map<string, KumaMonitor>();
  for (const monitor of monitors) {
    const domainId = readDomainId(monitor);
    if (domainId) {
      managed.set(domainId, monitor);
    }
  }

  const plan: ReconcilePlan = {
    create: [],
    update: [],
    retire: [],
    revive: [],
    managedCount: managed.size,
    domainCount: domains.length,
  };

  const seen = new Set<string>();

  for (const domain of domains) {
    seen.add(domain.domainId);
    const monitor = managed.get(domain.domainId);

    if (!monitor) {
      plan.create.push(domain);
      continue;
    }
    // A paused monitor whose domain is back in Dokploy has to be resumed, not just edited.
    if (!monitor.active) {
      plan.revive.push({ monitor, domain });
    }
    if (
      monitor.url !== domainToUrl(domain) ||
      monitor.name !== domainToMonitorName(domain)
    ) {
      plan.update.push({ monitor, domain });
    }
  }

  for (const [domainId, monitor] of managed) {
    if (!seen.has(domainId) && monitor.active) {
      plan.retire.push(monitor);
    }
  }

  return plan;
};

/**
 * Refuses to act when the plan looks like the result of a bad read rather than a real change.
 * Without this, one failed/partial database read would retire every monitor we manage.
 */
export const findGuardViolation = (
  plan: ReconcilePlan,
  config: Config,
): string | null => {
  if (plan.domainCount === 0 && plan.managedCount > 0) {
    return "Dokploy returned zero domains while managed monitors exist — refusing to retire everything";
  }

  const allowance = Math.max(
    MIN_RETIRE_ALLOWANCE,
    Math.floor(plan.managedCount * config.MAX_RETIRE_RATIO),
  );
  if (plan.retire.length > allowance) {
    return `Plan would retire ${plan.retire.length} of ${plan.managedCount} managed monitors (allowance ${allowance}) — refusing as a safety measure`;
  }

  return null;
};

export const applyPlan = async (
  plan: ReconcilePlan,
  kuma: KumaClient,
  config: Config,
  logger: Logger,
): Promise<void> => {
  for (const domain of plan.create) {
    const id = await kuma.addMonitor(buildMonitorPayload(domain, config));
    logger.info({ host: domain.host, monitorId: id }, "monitor created");
  }

  for (const { monitor, domain } of plan.update) {
    await kuma.editMonitor({
      ...buildMonitorPayload(domain, config),
      id: monitor.id,
    });
    logger.info(
      { host: domain.host, monitorId: monitor.id },
      "monitor updated",
    );
  }

  for (const { monitor, domain } of plan.revive) {
    await kuma.resumeMonitor(monitor.id);
    logger.info(
      { host: domain.host, monitorId: monitor.id },
      "monitor resumed",
    );
  }

  for (const monitor of plan.retire) {
    if (config.ON_REMOVE === "delete") {
      await kuma.deleteMonitor(monitor.id);
      logger.info(
        { monitorId: monitor.id, name: monitor.name },
        "monitor deleted",
      );
    } else {
      await kuma.pauseMonitor(monitor.id);
      logger.info(
        { monitorId: monitor.id, name: monitor.name },
        "monitor paused",
      );
    }
  }
};

export const runOnce = async (
  config: Config,
  kuma: KumaClient,
  logger: Logger,
): Promise<ReconcilePlan> => {
  const [domains, monitors] = await Promise.all([
    fetchDokployDomains(config.DATABASE_URL),
    kuma.listMonitors(),
  ]);

  const plan = buildPlan(domains, monitors);
  logger.info(
    {
      domains: plan.domainCount,
      managed: plan.managedCount,
      create: plan.create.length,
      update: plan.update.length,
      revive: plan.revive.length,
      retire: plan.retire.length,
    },
    "reconcile plan",
  );

  const violation = findGuardViolation(plan, config);
  if (violation) {
    throw new Error(violation);
  }

  if (config.DRY_RUN) {
    for (const domain of plan.create) {
      logger.info(
        { host: domain.host, url: domainToUrl(domain) },
        "would create",
      );
    }
    for (const { domain } of plan.update) {
      logger.info(
        { host: domain.host, url: domainToUrl(domain) },
        "would update",
      );
    }
    for (const monitor of plan.retire) {
      logger.info({ name: monitor.name }, `would ${config.ON_REMOVE}`);
    }
    logger.warn("DRY_RUN is on — no changes were sent to Kuma");
    return plan;
  }

  await applyPlan(plan, kuma, config, logger);
  return plan;
};
