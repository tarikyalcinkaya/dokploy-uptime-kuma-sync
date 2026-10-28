import postgres from 'postgres'
import { errorMessage } from '../../shared/errors.js'
import { DB_STATEMENT_TIMEOUT_MS, DB_TIMEOUT_SECONDS } from '../timeouts.js'

export type Sql = ReturnType<typeof postgres>

// The driver's bare `Invalid URL` hides which of the two usual causes it is, so name both.
export const connectDokploy = (
  databaseUrl: string,
  statementTimeoutMs = DB_STATEMENT_TIMEOUT_MS,
): Sql => {
  try {
    return postgres(databaseUrl, {
      max: 1,
      connect_timeout: DB_TIMEOUT_SECONDS,
      idle_timeout: DB_TIMEOUT_SECONDS,
      prepare: false,
      // Bounds a query stuck behind a lock; in loop mode it would otherwise hang the worker for good.
      connection: {
        statement_timeout: statementTimeoutMs,
        default_transaction_read_only: true,
      },
      // Read-only SELECTs; keeps postgres.js from echoing server notices to the console.
      onnotice: () => undefined,
    })
  } catch (error) {
    throw new Error(
      `DATABASE_URL could not be parsed (${errorMessage(error)}). Two things usually cause this: ` +
        '1) quotes — `docker run --env-file` does not strip them, so write the line unquoted; ' +
        '2) special characters in the password, which must be percent-encoded ' +
        '(@ = %40, # = %23, : = %3A, / = %2F, ? = %3F).',
      { cause: error },
    )
  }
}

export const closeDokploy = (sql: Sql): Promise<void> => sql.end({ timeout: DB_TIMEOUT_SECONDS })
