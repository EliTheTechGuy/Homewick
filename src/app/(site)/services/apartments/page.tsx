import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink, Card, CheckIcon, Section, SectionHeading } from "@/components/ui";
import { AddOnList } from "@/components/AddOnList";
import { PricingTable } from "@/components/PricingTable";
import { SERVICE_TYPES } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Apartment cleaning",
  description:
    "Standard, deep, and move in and out apartment cleaning in the Dallas-Fort Worth metroplex, with flat published pricing by apartment size.",
  alternates: { canonical: "/services/apartments" },
};

const included = {
  Kitchen: [
    "Counters, backsplash, and exterior of appliances",
    "Sink scrubbed and drain cleared of debris",
    "Cooktop and exterior of oven and microwave",
    "Cabinet fronts wiped",
    "Trash emptied and liner replaced",
  ],
  Bathrooms: [
    "Toilet cleaned inside and out",
    "Shower, tub, and tile scrubbed",
    "Sink, counter, and mirror",
    "Floors washed",
  ],
  "Bedrooms & living areas": [
    "Bed linens changed, included on every clean",
    "Surfaces dusted, including sills and reachable ledges",
    "Floors vacuumed and hard floors mopped",
    "Mirrors and glass",
  ],
  Throughout: [
    "Light switches, door handles, and other touch points",
    "Baseboards where reachable",
    "Trash collected and taken to the building's chute or bin",
  ],
};

const deepAdds = [
  "Baseboards and door frames in detail",
  "Buildup on tile grout and fixtures",
  "Interior window sills and tracks",
  "Behind and beneath movable furniture",
];

const moveOutAdds = [
  "Inside all cabinets and drawers",
  "Inside oven and refrigerator",
  "Closets and shelving",
  "Aimed at the condition a leasing office inspects against",
];

export default function ServicesPage() {
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          eyebrow="Apartments"
          title="Three services, priced by apartment size."
          lead="We specialize in apartments. Pricing is published up front and does not change at the door."
        />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {SERVICE_TYPES.map((s) => (
            <Card key={s.id}>
              <h3 className="text-xl font-semibold text-navy">{s.label}</h3>
              <p className="mt-3 leading-relaxed text-muted">{s.blurb}</p>
              {s.id === "deep" && <ExtraList title="Adds on top of standard" items={deepAdds} />}
              {s.id === "move_out" && <ExtraList title="Adds on top of deep" items={moveOutAdds} />}
            </Card>
          ))}
        </div>
      </Section>

      {/* Two rooms, shown rather than only listed. Both decorative next to a
          list that already names every task, so neither is described twice. */}
      <div className="mx-auto grid max-w-6xl gap-4 px-5 sm:grid-cols-2">
        <div className="relative h-64 overflow-hidden rounded-2xl">
          <Image
            src="/photography/bathroom.jpg"
            alt=""
            fill
            sizes="(min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
        <div className="relative h-64 overflow-hidden rounded-2xl">
          <Image
            src="/photography/towels.jpg"
            alt=""
            fill
            sizes="(min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>

      <Section tinted>
        <SectionHeading eyebrow="What's included" title="Every standard clean covers this." />
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {Object.entries(included).map(([room, items]) => (
            <Card key={room}>
              <h3 className="text-lg font-semibold text-navy">{room}</h3>
              <ul className="mt-4 space-y-2.5">
                {items.map((i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed text-body">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Pricing" title="One-time service." />
        <PricingTable className="mt-10" />
      </Section>

      <Section tinted>
        <SectionHeading eyebrow="Add-ons" title="Anything extra." />
        <AddOnList className="mt-10" />
        <div className="mt-10">
          <ButtonLink href="/book">Book online</ButtonLink>
        </div>
      </Section>
    </>
  );
}

function ExtraList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-5 border-t border-hairline pt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent">{title}</p>
      <ul className="mt-3 space-y-2">
        {items.map((i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-body">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
