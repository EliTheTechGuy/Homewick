import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingForm } from "@/components/BookingForm";
import { Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Book online",
  description:
    "Book an apartment cleaning or start a Homewick membership in the Dallas–Fort Worth metroplex.",
};

export default function BookPage() {
  return (
    <Section>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">Book online</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Tell us about your place and how we get in. Your card is entered with Stripe
          on the next screen — we never see or store it.
        </p>
      </div>

      <Suspense fallback={null}>
        <BookingForm />
      </Suspense>
    </Section>
  );
}
