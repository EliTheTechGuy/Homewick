import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/**
 * The pages worth indexing.
 *
 * Listed by hand rather than crawled, because the route tree also contains
 * things nobody should find in a search: the account area, admin, a cleaner's
 * job link, and the page a customer lands on after paying. Those already carry
 * noindex, and leaving them out here means the two do not have to agree.
 *
 * priority is relative within this site only. Pricing outranks the rest
 * because it is what people search for, and the service agreement is here to
 * be findable rather than to compete.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    { path: "", priority: 1, changeFrequency: "monthly" as const },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/membership", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/services", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/services/apartments", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/services/residential", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/book", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/terms", priority: 0.2, changeFrequency: "yearly" as const },
    { path: "/privacy", priority: 0.2, changeFrequency: "yearly" as const },
  ];

  return pages.map((page) => ({
    url: `${site.url}${page.path}`,
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
