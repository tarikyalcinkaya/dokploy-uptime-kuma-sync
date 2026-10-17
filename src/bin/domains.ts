// Prints the domains the sync would manage. Needs DATABASE_URL only — Kuma is never contacted.
import { listManagedDomains } from '../application/list-managed-domains.js'
import { loadDatabaseConfig } from '../infrastructure/config.js'
import { PostgresDomainSource } from '../infrastructure/dokploy/postgres-domain-source.js'
import { createLogger } from '../infrastructure/logger.js'
import { errorMessage } from '../shared/errors.js'

const main = async (): Promise<void> => {
  const config = loadDatabaseConfig()
  const logger = createLogger(config.LOG_LEVEL, config.LOG_FORMAT)

  const domains = await listManagedDomains(new PostgresDomainSource(config.DATABASE_URL))
  logger.info({ count: domains.length }, 'domains Dokploy is serving')
  for (const domain of domains) {
    logger.info(domain, 'domain')
  }
}

main().catch((error: unknown) => {
  createLogger('error').fatal({ err: errorMessage(error) }, 'could not read domains')
  process.exitCode = 1
})
