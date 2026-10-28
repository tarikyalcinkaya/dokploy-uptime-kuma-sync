// Prints the domains the sync would manage. Needs DATABASE_URL only — Kuma is never contacted.
import { listManagedDomains } from '../application/list-managed-domains.js'
import { loadDatabaseConfig, toExclusions } from '../infrastructure/config.js'
import { closeDokploy, connectDokploy } from '../infrastructure/dokploy/postgres-client.js'
import { PostgresDomainSource } from '../infrastructure/dokploy/postgres-domain-source.js'
import { createLogger } from '../infrastructure/logger.js'
import { errorMessage } from '../shared/errors.js'

const main = async (): Promise<void> => {
  const config = loadDatabaseConfig()
  const logger = createLogger(config.LOG_LEVEL, config.LOG_FORMAT)

  const sql = connectDokploy(config.DATABASE_URL)
  const domains = await listManagedDomains(
    new PostgresDomainSource(sql),
    config.GROUP_BY_PROJECT,
    config.HEALTH_PATHS,
    toExclusions(config),
  ).finally(() => closeDokploy(sql))
  logger.info({ count: domains.length }, 'domains Dokploy is serving')
  for (const domain of domains) {
    logger.info(domain, 'domain')
  }
}

main().catch((error: unknown) => {
  createLogger('error').fatal({ err: errorMessage(error) }, 'could not read domains')
  process.exitCode = 1
})
