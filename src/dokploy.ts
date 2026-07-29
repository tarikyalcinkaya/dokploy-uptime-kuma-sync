import postgres from "postgres";
import { DB_TIMEOUT_SECONDS } from "./constants.js";

export interface DokployDomain {
  domainId: string;
  host: string;
  https: boolean;
  path: string | null;
  domainType: string | null;
  serviceName: string | null;
  environmentName: string | null;
  projectName: string | null;
}

/**
 * Reads the domains Dokploy currently serves.
 *
 * Preview-deployment domains are excluded: they come and go with pull requests and would fill Kuma
 * with monitors that die within days. (They are GitHub-only in Dokploy today, but the filter costs
 * nothing and keeps this correct if that changes.)
 */
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
`;

/**
 * `Invalid URL` from the driver says nothing about which of the two likely causes it is, and both
 * are easy to hit, so name them.
 */
const connect = (databaseUrl: string): ReturnType<typeof postgres> => {
  try {
    return postgres(databaseUrl, {
      max: 1,
      connect_timeout: DB_TIMEOUT_SECONDS,
      idle_timeout: DB_TIMEOUT_SECONDS,
      prepare: false,
      onnotice: () => {},
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `DATABASE_URL could not be parsed (${reason}). Two things usually cause this: ` +
        "1) quotes — `docker run --env-file` does not strip them, so write the line unquoted; " +
        "2) special characters in the password, which must be percent-encoded " +
        "(@ = %40, # = %23, : = %3A, / = %2F, ? = %3F).",
    );
  }
};

export const fetchDokployDomains = async (
  databaseUrl: string,
): Promise<DokployDomain[]> => {
  const sql = connect(databaseUrl);

  try {
    const rows = await sql.unsafe<DokployDomain[]>(DOMAIN_QUERY);
    return [...rows];
  } finally {
    await sql.end({ timeout: DB_TIMEOUT_SECONDS });
  }
};

/** Public URL Kuma should probe. Dokploy's `port` column is the container port, not the public one. */
export const domainToUrl = (domain: DokployDomain): string => {
  const scheme = domain.https ? "https" : "http";
  const path = domain.path && domain.path !== "/" ? domain.path : "";
  const normalisedPath =
    path.length > 0 && !path.startsWith("/") ? `/${path}` : path;
  return `${scheme}://${domain.host}${normalisedPath}`;
};

export const domainToMonitorName = (domain: DokployDomain): string => {
  const context = [domain.projectName, domain.serviceName]
    .filter((part): part is string => Boolean(part))
    .join("/");
  return context.length > 0 ? `${context} · ${domain.host}` : domain.host;
};
