import type { Metadata } from "next";
import { BookingForm } from "@/components/BookingForm";
import { Section } from "@/components/ui";
import type { UnitSize } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Book online",
  description:
    "Book an apartment cleaning or start a Homewick membership in the Dallas–Fort Worth metroplex.",
};

const SIZES: UnitSize[] = ["studio_1br", "2br_2ba", "3br_2ba"];

/**
 * The plan and size arrive as query params from the pricing and membership
 * pages. They are resolved here, on the server, rather than with
 * useSearchParams in the client component — that hook returns empty on the
 * first render of a prerendered page, so a "Become a member" click could land
 * the customer on a form defaulted to a one-time clean.
 */
export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; size?: string }>;
}) {
  const { plan, size } = await searchParams;

  return (
    <Section>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">Book online</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Tell us about your place and how we get in. Your card is entered with Stripe
          on the next screen — we never see or store it.
        </p>
      </div>

      <BookingForm
        initialPlan={plan === "membership" ? "membership" : "one_time"}
        initialSize={SIZES.includes(size as UnitSize) ? (size as UnitSize) : "2br_2ba"}
      />
    </Section>
  );
}
