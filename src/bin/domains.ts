/**
 * Prints the domains dokploy-uptime-kuma-sync would manage. Needs DATABASE_URL only — no Kuma credentials, no
 * network calls to Kuma. Run this first to confirm the query sees what you expect.
 */
import { loadDatabaseConfig } from "../config.js";
import {
  domainToMonitorName,
  domainToUrl,
  fetchDokployDomains,
} from "../dokploy.js";
import { createLogger } from "../logger.js";

const main = async (): Promise<void> => {
  const config = loadDatabaseConfig();
  const logger = createLogger(config.LOG_LEVEL);

  const domains = await fetchDokployDomains(config.DATABASE_URL);
  logger.info({ count: domains.length }, "domains Dokploy is serving");

  for (const domain of domains) {
    logger.info(
      {
        url: domainToUrl(domain),
        monitorName: domainToMonitorName(domain),
        domainId: domain.domainId,
        type: domain.domainType,
      },
      "domain",
    );
  }
};

main().catch((error: unknown) => {
  createLogger("error").fatal(
    { err: error instanceof Error ? error.message : String(error) },
    "could not read domains",
  );
  process.exitCode = 1;
});
