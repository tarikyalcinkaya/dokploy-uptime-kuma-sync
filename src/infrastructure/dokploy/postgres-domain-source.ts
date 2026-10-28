import { z } from 'zod'
import type { DokployDomain } from '../../domain/dokploy-domain.js'
import type { IDomainSource } from '../../domain/ports.js'
import type { Sql } from './postgres-client.js'

// Dokploy keeps `idle` for a service that was stopped or never deployed; `error` is a real failure and stays watched.
const STOPPED_STATUS = 'idle'

// `to_jsonb` reads columns that older Dokploy releases lack as NULL instead of failing the query.
const queryDomains = (sql: Sql) => sql`
	SELECT
		d."domainId"      AS "domainId",
		d.host            AS host,
		d.https           AS https,
		d.path            AS path,
		d."domainType"    AS "domainType",
		COALESCE(a.name, c.name) AS "serviceName",
		e.name            AS "environmentName",
		(to_jsonb(e)->>'isDefault')::boolean AS "isDefaultEnvironment",
		p."projectId"     AS "projectId",
		p.name            AS "projectName",
		COALESCE(to_jsonb(a)->>'applicationStatus', to_jsonb(c)->>'composeStatus') AS "serviceStatus",
		COALESCE(to_jsonb(d)->'middlewares', '[]'::jsonb) AS middlewares
	FROM domain d
	LEFT JOIN application a ON a."applicationId" = d."applicationId"
	LEFT JOIN compose     c ON c."composeId"     = d."composeId"
	LEFT JOIN environment e ON e."environmentId" = COALESCE(a."environmentId", c."environmentId")
	LEFT JOIN project     p ON p."projectId"     = e."projectId"
	WHERE d."previewDeploymentId" IS NULL
		AND d."domainType" IS DISTINCT FROM 'preview'
		AND d.host IS NOT NULL
		AND btrim(d.host) <> ''
	ORDER BY d."createdAt", d."domainId"
`

const domainRowSchema = z.object({
  domainId: z.string().min(1),
  host: z.string().min(1),
  https: z.boolean(),
  path: z.string().nullable(),
  domainType: z.string().nullable(),
  serviceName: z.string().nullable(),
  environmentName: z.string().nullable(),
  isDefaultEnvironment: z.boolean().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  serviceStatus: z.string().nullable(),
  middlewares: z
    .array(z.string())
    .nullable()
    .transform((value) => value ?? []),
})

const toDomain = ({
  https,
  serviceStatus,
  ...row
}: z.infer<typeof domainRowSchema>): DokployDomain => ({
  ...row,
  isHttps: https,
  isStopped: serviceStatus === STOPPED_STATUS,
})

export class PostgresDomainSource implements IDomainSource {
  readonly #sql: Sql

  constructor(sql: Sql) {
    this.#sql = sql
  }

  async listDomains(): Promise<DokployDomain[]> {
    const rows = await queryDomains(this.#sql)
    return z
      .array(domainRowSchema)
      .parse([...rows])
      .map(toDomain)
  }
}
