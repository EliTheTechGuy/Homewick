import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * Vercel already sends HSTS, so that is not repeated here.
 *
 * On the deliberate absence of script-src: a CSP that restricts scripts needs
 * a per-request nonce, because Next inlines the server-rendered payload as
 * inline script tags. Generating a nonce forces every page to be rendered
 * dynamically, which would turn the marketing pages from static files into
 * per-request work, and those pages are the ones that need to be fast for
 * search and for somebody on a phone. The alternative, allowing
 * 'unsafe-inline', would let anything run and buy nothing at all.
 *
 * So this CSP is honest about what it is for: stopping the page being framed,
 * having its base rewritten, or having its forms redirected. Those are real
 * attacks with no downside to blocking. It is not an XSS defence, and calling
 * it one would be worse than not having it.
 */
const CSP = [
  // Clickjacking. This is the one that matters most: admin reveals customer
  // door codes, and an invisible iframe over a decoy page is how somebody
  // gets an authenticated admin to click a button they cannot see.
  "frame-ancestors 'none'",
  // Stops an injected <base> tag silently repointing every relative URL.
  "base-uri 'self'",
  // A form can only submit back to us, so a rewritten action cannot post
  // somebody's address and door code to another host.
  "form-action 'self'",
  // Nothing on this site needs Flash, Java, or an embedded object.
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const baseHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  // The older header that does the same job as frame-ancestors, for browsers
  // and scanners that only look for this one.
  { key: "X-Frame-Options", value: "DENY" },
  // Stops a browser deciding an uploaded or user-influenced response is really
  // HTML and running it.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Cross-origin requests send only the origin, never the path. This matters
  // here because several URLs carry a token in the path, and the default
  // behaviour would hand that token to any site a customer clicked through to.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here needs a camera, a microphone, or a location.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      {
        // The pages whose URL is itself a credential. Sending no referrer at
        // all is stricter than the site default, which still leaks the origin.
        // The feedback page links out to a review site, and that click should
        // carry nothing.
        source: "/:path(feedback|unsubscribe)/:rest*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/account/verify",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        // Belt and braces alongside the noindex already in the page metadata.
        // A header is read even when a crawler does not render the page.
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
