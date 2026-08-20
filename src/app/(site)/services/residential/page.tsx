import type { Metadata } from "next";
import Image from "next/image";
import { Card, Section, SectionHeading } from "@/components/ui";
import { EnquiryForm } from "@/components/EnquiryForm";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "House cleaning",
  description:
    "House and residential cleaning across the Dallas-Fort Worth metroplex, quoted by square footage. Standard, deep, and move in and out, one off or recurring.",
  alternates: { canonical: "/services/residential" },
};

/**
 * Houses, which cannot be priced from the published matrix.
 *
 * The page has to do two things at once: convince somebody we are worth
 * asking, and be honest that we cannot give them a number on the spot. Being
 * straight about why is the better trade. A range wide enough to be safe is
 * useless to the reader, and a number we later revise upward is worse than no
 * number at all.
 */
const covered = [
  "Kitchen, including counters, sink, cabinet fronts, and the outside of every appliance",
  "Every bathroom, scrubbed and disinfected throughout",
  "All floors vacuumed and mopped, stairs included",
  "Dusting from light fittings down to baseboards",
  "Beds made and linens changed",
  "Trash out, liners replaced",
];

const pricedOn = [
  {
    title: "Square footage",
    body: "The biggest factor. A 1,400 square foot house and a 3,200 square foot house are not the same job, and the price should say so.",
  },
  {
    title: "Layout and floors",
    body: "Stairs, split levels, and long runs of hard floor all add time, and so does five bathrooms against two.",
  },
  {
    title: "How it has been kept",
    body: "A house cleaned every few weeks is a different job from one that has not been done in a year. We would rather ask than guess.",
  },
];

export default function ResidentialPage() {
  return (
    <>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <SectionHeading
              as="h1"
              eyebrow="Houses"
              title="House cleaning, quoted properly."
              lead={`We clean houses across the ${site.serviceArea}, one off or on a schedule that suits you. Tell us about the place and we come back with a real number, usually the same day.`}
            />
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
            <Image
              src="/photography/living-room.jpg"
              alt="A bright, freshly cleaned living room"
              fill
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="object-cover"
              priority
            />
          </div>
        </div>
      </Section>

      <Section tinted>
        <SectionHeading
          eyebrow="How we price it"
          title="Three things set the number."
          lead="Tell us about them and you get a real price rather than a range. No walkthrough needed, and nothing changes once we arrive."
        />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {pricedOn.map((r) => (
            <Card key={r.title}>
              <h3 className="text-lg font-semibold text-navy">{r.title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{r.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 md:grid-cols-2">
          <SectionHeading
            eyebrow="What a clean covers"
            title="Every room, every time."
            lead="Deep cleans add baseboards, buildup, and detail work on top. Move in and out is aimed at the condition an inspection is held against."
          />
          <ul className="space-y-3">
            {covered.map((c) => (
              <li key={c} className="leading-relaxed text-body">
                {c}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section tinted>
        <div className="mx-auto max-w-2xl">
          <SectionHeading
            eyebrow="Get a quote"
            title="Tell us about the house."
            lead="Only your name, email and phone are required. Everything else just helps us come back faster."
          />
          <div className="mt-10">
            <EnquiryForm />
          </div>
        </div>
      </Section>
    </>
  );
}
