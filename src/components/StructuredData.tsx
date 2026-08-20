import { site } from "@/lib/site";
import { MEMBERSHIP_PRICES, SERVICE_PRICES, UNIT_SIZES } from "@/lib/pricing";

/**
 * Tells search engines what this business is, where it works, and what it
 * charges.
 *
 * Without it a search engine has to infer all of that from prose, and for a
 * local service business that inference is the difference between appearing
 * for "apartment cleaning dallas" and not appearing at all. It is the single
 * highest-leverage thing on the marketing side of this site.
 *
 * Prices come from the same constants the booking form quotes from, so the
 * two cannot drift. A rich result advertising a price the checkout then
 * contradicts is worse than no rich result.
 *
 * Deliberately no aggregateRating. Google requires ratings to be genuinely
 * collected and displayed on the page, and inventing one is both against
 * their guidelines and a lie about a business nobody has reviewed yet.
 */
export function StructuredData() {
  const cheapest = Math.min(...Object.values(SERVICE_PRICES).map((s) => s.standard));

  const data = {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    "@id": `${site.url}/#business`,
    name: site.name,
    legalName: site.legalEntity,
    url: site.url,
    description:
      "House and apartment cleaning in the Dallas-Fort Worth metroplex. Standard, deep, and move in and out cleans. Apartments at flat published rates, houses quoted by square footage, with a membership option covering two cleanings a month.",
    ...(site.email ? { email: site.email } : {}),
    ...(site.phone ? { telephone: site.phone } : {}),
    priceRange: "$$",
    currenciesAccepted: "USD",
    paymentAccepted: "Credit Card",
    areaServed: {
      "@type": "AdministrativeArea",
      name: site.serviceArea,
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Dallas",
      addressRegion: "TX",
      addressCountry: "US",
    },
    // Cleaners travel to the customer; there is no shop to visit.
    serviceType: ["House cleaning", "Apartment cleaning"],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Cleaning services",
      itemListElement: [
        ...UNIT_SIZES.map((size) => ({
          "@type": "Offer",
          name: `Membership, ${size.label}`,
          description: "Two cleanings per month, one free add-on each month.",
          price: (MEMBERSHIP_PRICES[size.id].monthlyCents / 100).toFixed(2),
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: `${site.url}/membership`,
        })),
        ...UNIT_SIZES.map((size) => ({
          "@type": "Offer",
          name: `One-time standard clean, ${size.label}`,
          price: (SERVICE_PRICES[size.id].standard / 100).toFixed(2),
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: `${site.url}/pricing`,
        })),
      ],
    },
    offers: {
      "@type": "AggregateOffer",
      lowPrice: (cheapest / 100).toFixed(2),
      priceCurrency: "USD",
      offerCount: UNIT_SIZES.length * 2,
    },
  };

  return (
    <script
      type="application/ld+json"
      // Generated from our own constants, so there is no user input to escape.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
