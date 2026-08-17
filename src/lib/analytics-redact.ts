/**
 * Strip credentials and identifiers out of a URL before it is counted.
 *
 * Two separate problems, handled two ways.
 *
 * Some public URLs carry a bearer token in the path, and a token is a
 * credential:
 *
 *   /feedback/<hmac>                 leaves a rating as that customer
 *   /unsubscribe/<customer>/<hmac>   stops that customer's emails
 *   /account/verify?token=           signs in as that customer
 *
 * Sent as-is to an analytics provider, those would sit in a dashboard as a
 * working set of keys to other people's accounts.
 *
 * Query strings are the other problem. The confirmation pages carry
 * ?ref=<booking id>&session_id=<stripe session>, which is not a credential but
 * is an identifier tied to one person's booking, and the privacy policy says
 * what we count is not tied to your account or your booking. So query
 * parameters are dropped unless they are on the list below.
 *
 * A list of what to keep rather than a list of what to drop, on purpose. The
 * first kind of mistake loses a statistic. The second kind ships customer data
 * and nobody notices, because nothing visibly breaks either way.
 *
 * Kept out of the component so it can be tested.
 */

/** Any path starting with one of these has a credential in it. */
export const SECRET_PATHS = ["/feedback/", "/unsubscribe/", "/account/verify"];

/**
 * Query parameters worth keeping. Campaign attribution, which is the whole
 * point of measuring, plus the flag that says a checkout was abandoned.
 * Everything else is dropped whether or not we recognise it.
 */
export const KEPT_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  // Google, Microsoft and Meta each stamp their own click id on the landing URL.
  "gclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "fbclid",
  "canceled",
];

/**
 * The same URL with anything sensitive removed, or null if it should not be
 * sent at all. Add new token-bearing routes to SECRET_PATHS.
 */
export function redactAnalyticsUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Unparseable means we cannot tell what is in it, so send nothing.
    return null;
  }

  const secret = SECRET_PATHS.find((prefix) => url.pathname.startsWith(prefix));
  if (secret) {
    // The prefix is the part worth counting. Everything after it is the secret.
    url.pathname = `${secret.replace(/\/$/, "")}/redacted`;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  for (const key of [...url.searchParams.keys()]) {
    if (!KEPT_PARAMS.includes(key)) url.searchParams.delete(key);
  }
  // A fragment never reaches the server and has no business being counted.
  url.hash = "";

  return url.toString();
}
