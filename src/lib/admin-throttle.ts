import { query } from "./db";
import { alertOwner } from "./alert";

/**
 * Slow down guessing at the admin password.
 *
 * There is one shared password and it unlocks every customer's entry codes.
 * Nothing counted failures, nothing delayed them, and nothing recorded them,
 * so an attacker could work through a list at full speed and leave no trace.
 *
 * This does not try to be a lockout. A lockout on a single shared credential
 * is a way for a stranger to lock the owner out of their own business on a
 * working morning. It makes guessing slow and noisy instead, which is what
 * actually defeats an online attack, and it tells the owner when somebody is
 * clearly trying.
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
      `${failures + 1} failed admin sign-ins from ${ip} in the last ${WINDOW_MINUTES} minutes.\n\n` +
        `Admin unlocks every customer's entry codes, so this is worth taking ` +
        `seriously. Changing ADMIN_PASSWORD in Vercel and redeploying ends it ` +
        `immediately.\n\n` +
        `If this was you locked out, ignore it.`,
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
