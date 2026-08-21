import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink, Card, Section, SectionHeading } from "@/components/ui";
import { PricingTable } from "@/components/PricingTable";
import { MembershipCards } from "@/components/MembershipCards";
import { AddOnList } from "@/components/AddOnList";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Flat published pricing for apartment cleaning in Dallas-Fort Worth. One-time and membership rates by apartment size.",
};

export default function PricingPage() {
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          eyebrow="Pricing"
          title="Everything published, nothing quoted at the door."
          lead="Rates are set by apartment size and service. What you see here is what you are charged."
        />
      </Section>

      <Section tinted>
        <h2 className="text-2xl font-semibold text-navy">One-time cleaning</h2>
        <PricingTable className="mt-8" />
      </Section>

      <Section>
        <h2 className="text-2xl font-semibold text-navy">Membership</h2>
        <p className="mt-3 max-w-2xl text-muted">
          Two cleanings every month for one charge, at 15% off the one-time rate for each
          visit.
        </p>
        <MembershipCards className="mt-10" />
      </Section>

      {/* A break between three tables in a row. Decorative next to pricing
          that already says everything, so the alt is empty rather than making
          a screen reader sit through a description on the way to the numbers. */}
      <div className="relative h-52 w-full md:h-64">
        <Image
          src="/photography/living-room.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
        />
      </div>

      <Section tinted>
        <h2 className="text-2xl font-semibold text-navy">Add-ons</h2>
        <AddOnList className="mt-8" />
      </Section>

      <Section>
        <Card className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-xl font-semibold text-navy">Cleaning a house?</h2>
            <p className="mt-2 max-w-xl text-muted">
              Houses are quoted by square footage rather than bedroom count, so they do
              not appear on the rates above. Tell us about the place and we come back
              with a real number, usually the same day.
            </p>
          </div>
          {/* The booking form only offers apartment sizes, so sending a house
              there was a dead end: somebody following the instruction arrived
              at a form with no option that fitted them. */}
          <ButtonLink href="/services/residential" className="shrink-0">
            Get a quote
          </ButtonLink>
        </Card>
      </Section>
    </>
  );
}
