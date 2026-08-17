/**
 * Strip credentials out of a URL before it is counted.
 *
 * Several public URLs carry a bearer token in the path or the query string,
 * and a token is a credential:
 *
 *   /feedback/<hmac>                 leaves a rating as that customer
 *   /unsubscribe/<customer>/<hmac>   stops that customer's emails
 *   /account/verify?token=...        signs in as that customer
 *
 * Sent as-is to an analytics provider, those would sit in a dashboard as a
 * working set of keys to other people's accounts. Rewriting the URL keeps the
 * visit counted and throws the credential away.
 *
 * Kept out of the component so it can be tested. A quiet regression here does
 * not break anything visible, it just starts shipping tokens.
 */

/** Any path starting with one of these has a credential in it. */
export const SECRET_PATHS = ["/feedback/", "/unsubscribe/", "/account/verify"];

/**
 * The same URL with anything secret replaced, or null if it should not be
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

  const match = SECRET_PATHS.find((prefix) => url.pathname.startsWith(prefix));
  if (!match) return rawUrl;

  // The prefix is the part worth counting. Everything after it is the secret.
  url.pathname = `${match.replace(/\/$/, "")}/redacted`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
