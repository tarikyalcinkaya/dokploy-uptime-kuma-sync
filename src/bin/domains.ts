// Prints the domains a reconcile would plan for (`--all`: every row Dokploy holds); needs DATABASE_URL only.
import { listManagedDomains } from '../application/list-managed-domains.js'
import { loadDatabaseConfig, toExclusions } from '../infrastructure/config.js'
import { closeDokploy, connectDokploy } from '../infrastructure/dokploy/postgres-client.js'
import { PostgresDomainSource } from '../infrastructure/dokploy/postgres-domain-source.js'
import { createLogger } from '../infrastructure/logger.js'
import { errorMessage } from '../shared/errors.js'

const main = async (): Promise<void> => {
  const config = loadDatabaseConfig()
  const logger = createLogger(config.LOG_LEVEL, config.LOG_FORMAT)

  const watchedOnly = !process.argv.includes('--all')
  const sql = connectDokploy(config.DATABASE_URL)
  const domains = await listManagedDomains(
    new PostgresDomainSource(sql),
    config.GROUP_BY_PROJECT,
    config.HEALTH_PATHS,
    toExclusions(config),
    watchedOnly,
  ).finally(() => closeDokploy(sql))
  logger.info(
    { count: domains.length },
    watchedOnly ? 'domains the sync would watch' : 'domains Dokploy is serving',
  )
  for (const domain of domains) {
    logger.info(domain, 'domain')
  }
}

main().catch((error: unknown) => {
  createLogger('error').fatal({ err: errorMessage(error) }, 'could not read domains')
  process.exitCode = 1
})
