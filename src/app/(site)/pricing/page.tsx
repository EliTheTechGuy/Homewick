import type { Metadata } from "next";
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

      <Section tinted>
        <h2 className="text-2xl font-semibold text-navy">Add-ons</h2>
        <AddOnList className="mt-8" />
      </Section>

      <Section>
        <Card className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-xl font-semibold text-navy">Not an apartment?</h2>
            <p className="mt-2 max-w-xl text-muted">
              Single-family homes are quoted separately by square footage rather than
              bedroom count. Get in touch through the booking form and we will price it.
            </p>
          </div>
          <ButtonLink href="/book" className="shrink-0">
            Book online
          </ButtonLink>
        </Card>
      </Section>
    </>
  );
}
