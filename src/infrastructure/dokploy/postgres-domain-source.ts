import postgres from 'postgres'
import { z } from 'zod'
import type { DokployDomain } from '../../domain/dokploy-domain.js'
import type { IDomainSource } from '../../domain/ports.js'
import { errorMessage } from '../../shared/errors.js'
import { DB_TIMEOUT_SECONDS } from '../timeouts.js'

// Preview domains come and go with pull requests and would fill Kuma with monitors that die within days.
const DOMAIN_QUERY = `
	SELECT
		d."domainId"      AS "domainId",
		d.host            AS host,
		d.https           AS https,
		d.path            AS path,
		d."domainType"    AS "domainType",
		COALESCE(a.name, c.name) AS "serviceName",
		e.name            AS "environmentName",
		p.name            AS "projectName"
	FROM domain d
	LEFT JOIN application a ON a."applicationId" = d."applicationId"
	LEFT JOIN compose     c ON c."composeId"     = d."composeId"
	LEFT JOIN environment e ON e."environmentId" = COALESCE(a."environmentId", c."environmentId")
	LEFT JOIN project     p ON p."projectId"     = e."projectId"
	WHERE d."previewDeploymentId" IS NULL
		AND d."domainType" IS DISTINCT FROM 'preview'
		AND d.host IS NOT NULL
		AND btrim(d.host) <> ''
	ORDER BY d."createdAt"
`

const domainRowSchema = z.object({
  domainId: z.string().min(1),
  host: z.string().min(1),
  https: z.boolean(),
  path: z.string().nullable(),
  domainType: z.string().nullable(),
  serviceName: z.string().nullable(),
  environmentName: z.string().nullable(),
  projectName: z.string().nullable(),
})

const toDomain = ({ https, ...row }: z.infer<typeof domainRowSchema>): DokployDomain => ({
  ...row,
  isHttps: https,
})

export class PostgresDomainSource implements IDomainSource {
  readonly #databaseUrl: string

  constructor(databaseUrl: string) {
    this.#databaseUrl = databaseUrl
  }

  async listDomains(): Promise<DokployDomain[]> {
    const sql = this.#connect()
    try {
      const rows = await sql.unsafe(DOMAIN_QUERY)
      return z
        .array(domainRowSchema)
        .parse([...rows])
        .map(toDomain)
    } finally {
      await sql.end({ timeout: DB_TIMEOUT_SECONDS })
    }
  }

  // The driver's bare `Invalid URL` hides which of the two usual causes it is, so name both.
  #connect(): ReturnType<typeof postgres> {
    try {
      return postgres(this.#databaseUrl, {
        max: 1,
        connect_timeout: DB_TIMEOUT_SECONDS,
        idle_timeout: DB_TIMEOUT_SECONDS,
        prepare: false,
        onnotice: () => undefined,
      })
    } catch (error) {
      throw new Error(
        `DATABASE_URL could not be parsed (${errorMessage(error)}). Two things usually cause this: ` +
          '1) quotes — `docker run --env-file` does not strip them, so write the line unquoted; ' +
          '2) special characters in the password, which must be percent-encoded ' +
          '(@ = %40, # = %23, : = %3A, / = %2F, ? = %3F).',
      )
    }
  }
}
