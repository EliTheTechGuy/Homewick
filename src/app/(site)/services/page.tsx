import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ButtonLink, Card, Section, SectionHeading } from "@/components/ui";
import { SERVICE_PRICES } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Home cleaning across the Dallas-Fort Worth metroplex. Apartments at flat published rates, houses quoted by square footage.",
  alternates: { canonical: "/services" },
};

/**
 * The fork between the two ways we sell.
 *
 * Apartments are priced from a fixed matrix, so they can be booked and paid
 * for in one sitting. Houses vary too much for that: square footage, layout,
 * and how many floors all move the number, and quoting one blind would mean
 * either losing money or over-charging. So houses are an enquiry.
 *
 * This page keeps the /services URL, which is indexed and sits in the sitemap,
 * rather than redirecting it at a moment when search has only just found the
 * site.
 */
export default function ServicesPage() {
  const fromApartment = Math.min(
    ...Object.values(SERVICE_PRICES).map((sizes) => sizes.standard),
  );

  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          eyebrow="Services"
          title="Two kinds of home, priced two different ways."
          lead="We clean apartments and houses across the Dallas-Fort Worth metroplex. The difference is only in how the price is worked out."
        />
      </Section>

      <Section tinted>
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="flex flex-col">
            <h2 className="text-2xl font-semibold text-navy">Apartments</h2>
            <p className="mt-1 text-sm font-medium text-accent">
              from ${(fromApartment / 100).toFixed(0)}, published
            </p>
            <p className="mt-4 flex-1 leading-relaxed text-muted">
              Standard, deep, and move in and out, priced by apartment size. Nothing is
              quoted at the door, so you can book and pay online in a couple of minutes.
              Add a membership if you want it handled every month.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/services/apartments">What is included</ButtonLink>
              <ButtonLink href="/book" variant="secondary">
                Book online
              </ButtonLink>
            </div>
          </Card>

          <Card className="flex flex-col">
            <h2 className="text-2xl font-semibold text-navy">Houses</h2>
            <p className="mt-1 text-sm font-medium text-accent">quoted, usually same day</p>
            <p className="mt-4 flex-1 leading-relaxed text-muted">
              Houses vary too much to publish a rate honestly. Square footage, layout,
              and how many floors all change the work, so tell us about the place and we
              come back with a real number rather than a range.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/services/residential">Get a quote</ButtonLink>
            </div>
          </Card>
        </div>
      </Section>

      {/* Decorative between two sections that both carry their own detail. */}
      <div className="relative h-52 w-full md:h-64">
        <Image
          src="/photography/sofa.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
        />
      </div>

      <Section>
        <SectionHeading
          eyebrow="Either way"
          title="The same standard, the same people."
          lead="Whichever kind of home you have, the promises do not change."
        />
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {[
            "Bed linens changed on every clean",
            "The same cleaner whenever scheduling allows",
            "Entry codes encrypted and shared only with the cleaner on the day",
            "If something is wrong, tell us within 48 hours and we come back",
          ].map((s) => (
            <li key={s} className="leading-relaxed text-body">
              {s}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-muted">
          Full apartment rates are on the{" "}
          <Link href="/pricing" className="font-medium text-accent hover:underline">
            pricing page
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
