import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Postgres access. Supabase/Neon both hand you a pooled connection string —
 * use the pooler URL in serverless, not the direct one.
 */

declare global {
  // eslint-disable-next-line no-var
  var __homewickPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
}

/** Reused across hot reloads in dev so we don't leak connections. */
export function pool(): Pool {
  if (!globalThis.__homewickPool) globalThis.__homewickPool = createPool();
  return globalThis.__homewickPool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Runs fn inside a transaction, rolling back on any throw. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The one place a date-only value becomes an absolute instant.
 *
 * Postgres resolves the offset for the given local date and time, so DST is
 * handled by the tz database rather than by us guessing at -5 or -6.
 * Pass the 1-based positions of the date, time, and timezone parameters.
 */
export function timestamptzFromLocal(
  dateParam: number,
  timeParam: number,
  tzParam: number,
): string {
  return `(($${dateParam}::date + $${timeParam}::time) at time zone $${tzParam})`;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
