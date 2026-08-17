"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { redactAnalyticsUrl } from "@/lib/analytics-redact";

/**
 * Page counts and page speed for the public site.
 *
 * Both are cookieless and neither sets a persistent identifier, which is why
 * there is no consent banner: there is nothing to consent to.
 *
 * Every URL goes through redactAnalyticsUrl first, because some public routes
 * carry a bearer token. See that file for what and why.
 */
export function SiteAnalytics() {
  return (
    <>
      <Analytics
        beforeSend={(event) => {
          const url = redactAnalyticsUrl(event.url);
          return url ? { ...event, url } : null;
        }}
      />
      <SpeedInsights
        beforeSend={(event) => {
          const url = redactAnalyticsUrl(event.url);
          return url ? { ...event, url } : null;
        }}
      />
    </>
  );
}
