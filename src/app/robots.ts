import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/**
 * What crawlers may look at.
 *
 * The disallowed paths all carry noindex already, so this is belt and braces
 * rather than the only guard. It is worth having anyway: noindex only takes
 * effect once a crawler has fetched the page, and a cleaner's job link or a
 * member's account page is not something to have fetched at all.
 *
 * /api is excluded because there is nothing there for a reader, and a crawler
 * hitting the cron endpoint repeatedly is a waste of everyone's time.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/admin", "/job", "/feedback", "/api"],
    },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
