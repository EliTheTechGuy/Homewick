import { query } from "./db";
import { alertOwner } from "./alert";

/**
 * Slow down somebody working through addresses at the admin sign-in.
 *
 * There is no password to guess any more, so this no longer defends a
 * credential. What it defends is the address list: without it, the sign-in
 * form answers instantly for every address, and somebody could work out which
 * ones can reach admin by trying a lot of them.
 *
 * Still not a lockout. Locking on a request nobody has to authenticate for is
 * a way for a stranger to stop the owner signing in on a working morning.
 *
 * Counted per address in the database rather than in memory, because the site
 * runs as many short-lived instances and a counter inside one of them counts
 * almost nothing.
 */

/** Failures from one address before every further attempt is delayed. */
const FREE_ATTEMPTS = 5;

/** How far back failures are counted. */
const WINDOW_MINUTES = 15;

/** Failures before the owner is told somebody is working through guesses. */
const ALERT_AT = 20;

const MAX_DELAY_MS = 4000;

export async function recentFailures(ip: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `select count(*)::int as n from admin_login_attempts
      where ip = $1 and attempted_at > now() - ($2 || ' minutes')::interval`,
    [ip, String(WINDOW_MINUTES)],
  ).catch(() => []);
  return rows[0]?.n ?? 0;
}

/**
 * Make a wrong password cost time.
 *
 * The delay grows with the number of recent failures, so a person who
 * mistypes once notices nothing and a script trying thousands gets a few
 * seconds each. Capped, because an unbounded delay is a way to tie up every
 * serverless instance the site has, which would be a denial of service
 * somebody could trigger deliberately.
 */
export async function throttleFailure(ip: string): Promise<void> {
  const failures = await recentFailures(ip);

  await query(`insert into admin_login_attempts (ip) values ($1)`, [ip]).catch((err) =>
    console.error("[admin] could not record a failed attempt", err),
  );

  if (failures + 1 === ALERT_AT) {
    await alertOwner(
      "Somebody is guessing the admin password",
      `${failures + 1} failed admin sign-in attempts from ${ip} in the last ` +
        `${WINDOW_MINUTES} minutes.\n\n` +
        `These are requests for a sign-in link using an address that cannot ` +
        `sign in, which is what working through a list of addresses looks ` +
        `like. Nobody can get in without receiving an email, so this is worth ` +
        `knowing about rather than acting on.\n\n` +
        `If it continues, tell me and I will block the address.`,
    );
  }

  if (failures < FREE_ATTEMPTS) return;

  const delay = Math.min((failures - FREE_ATTEMPTS + 1) * 500, MAX_DELAY_MS);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** A correct password clears the slate, so one bad morning does not linger. */
export async function clearFailures(ip: string): Promise<void> {
  await query(`delete from admin_login_attempts where ip = $1`, [ip]).catch(() => {});
}
