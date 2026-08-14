import type { Metadata } from "next";
import { ButtonLink, Card, Section } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Booking received",
};

/**
 * Two outcomes land here.
 *
 * The ordinary one is a customer returning from Stripe, having paid. The other
 * is a booking that saved but whose payment could not be started — Stripe
 * unreachable, or not configured. That second case must not be dressed up as
 * the first: the customer would walk away believing they were booked and paid,
 * and the visit would sit on the calendar unpaid with nobody aware of it.
 */
export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; payment?: string }>;
}) {
  const { ref, payment } = await searchParams;
  const paymentPending = payment === "pending";

  return (
    <Section>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">
          {paymentPending ? "Booking saved — payment still to do" : "Booking received"}
        </h1>

        {paymentPending ? (
          <>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              We have your details and your visit is held, but we could not start
              the payment step just now, so <strong>nothing has been charged</strong>.
            </p>
            <p className="mt-4 leading-relaxed text-muted">
              You do not need to book again — that would create a second visit. We
              will contact you to take payment and confirm the date.
              {site.email && (
                <>
                  {" "}
                  If you would rather reach us first, email{" "}
                  <a href={`mailto:${site.email}`} className="font-medium text-accent">
                    {site.email}
                  </a>
                  .
                </>
              )}
            </p>
          </>
        ) : (
          <p className="mt-4 text-lg leading-relaxed text-muted">
            We have your details. You will get a text confirming the date and arrival
            window before your first visit.
          </p>
        )}

        {ref && (
          <Card className="mt-8">
            <p className="text-sm text-muted">Your reference</p>
            <p className="mt-1 font-mono text-sm text-navy">{ref}</p>
            {paymentPending && (
              <p className="mt-3 text-sm text-muted">
                Quote this if you get in touch.
              </p>
            )}
          </Card>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/">Back to home</ButtonLink>
          <ButtonLink href="/terms" variant="secondary">
            Service agreement
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
