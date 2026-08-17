import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Postgres access. Supabase/Neon both hand you a pooled connection string, * use the pooler URL in serverless, not the direct one.
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
    ssl: sslFor(connectionString),
  });
}

/**
 * Hosted Postgres (Supabase, Neon) requires TLS; a local one generally has no
 * certificate at all and refuses the handshake. Matching on the literal string
 * "localhost" is not enough, 127.0.0.1 and ::1 are just as local.
 */
/**
 * How to encrypt the connection, and whether to check who is on the other end.
 *
 * TLS without verification stops somebody passively reading the wire. It does
 * not stop somebody who can answer in Postgres's place: they present any
 * certificate, we accept it, and the very first thing we send is the database
 * password in the connection handshake. After that they can read and rewrite
 * every row, and the credentials keep working afterwards.
 *
 * Supabase signs with its own root rather than a public one, so the system
 * trust store cannot verify it. The certificate therefore has to be supplied,
 * and it lives in DATABASE_CA_CERT. Download it from the Supabase dashboard
 * under Settings, Database, SSL configuration.
 *
 * Without it the old behaviour continues, because refusing to connect would
 * take the whole site down over a warning. It says so loudly instead.
 */
export function sslFor(
  connectionString: string,
): { rejectUnauthorized: boolean; ca?: string } | undefined {
  let host = "";
  let sslmode: string | null = null;
  try {
    const url = new URL(connectionString);
    host = url.hostname.replace(/^\[|\]$/g, "");
    sslmode = url.searchParams.get("sslmode");
  } catch {
    // Fall through: an unparseable string gets the safe, TLS-on default.
  }

  if (sslmode === "disable") return undefined;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return undefined;

  const ca = process.env.DATABASE_CA_CERT?.trim();
  if (ca) return { rejectUnauthorized: true, ca };

  warnOnceAboutUnverifiedTls();
  return { rejectUnauthorized: false };
}

// A serverless function is short lived, so this is per instance rather than
// per process for its whole life. Still enough to stop it repeating on every
// query while remaining visible in the logs.
let warnedAboutTls = false;
function warnOnceAboutUnverifiedTls(): void {
  if (warnedAboutTls) return;
  warnedAboutTls = true;
  console.warn(
    "[db] connecting without verifying the database certificate. " +
      "Set DATABASE_CA_CERT to the Supabase CA to close this.",
  );
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
