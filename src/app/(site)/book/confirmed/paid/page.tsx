import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ButtonLink, Card, Section } from "@/components/ui";
import { stripe } from "@/lib/stripe";
import { verdictFromSession, type PaymentVerdict } from "@/lib/checkout-verdict";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Booking confirmed",
  // Not linked from anywhere and it should not turn up in search results.
  robots: { index: false, follow: false },
};

/**
 * The page a customer sees only after actually paying.
 *
 * It exists so advertising can be measured against real revenue. Google Ads
 * counts a conversion when a particular URL loads, which means the URL has to
 * mean one thing. /book/confirmed did not: it also catches bookings whose
 * payment could not be started at all, and counting those would report sales
 * that never happened.
 *
 * Stripe is asked whether the session was really paid, rather than trusting
 * the redirect, because the URL is otherwise guessable and a conversion tag
 * fires on load. The three outcomes are deliberate:
 *
 *   paid      show this page, count it
 *   unpaid    send them to the ordinary confirmation, count nothing
 *   unknown   show this page anyway
 *
 * That last one is the one worth arguing about. If Stripe is unreachable we
 * cannot tell, and the two ways of being wrong are not equal: over-count a
 * conversion, or tell somebody who just paid that they did not. The customer
 * matters more than the reporting, so it fails towards the customer. Stripe
 * being down is also rare and brief, while the alternative is a support call
 * from somebody holding a receipt.
 *
 * An id Stripe rejects is not an outage, it is an answer, so that counts as
 * unpaid.
 */
async function verdictFor(sessionId: string | undefined): Promise<PaymentVerdict> {
  // No id at all means this was typed or crawled rather than redirected.
  if (!sessionId) return "unpaid";

  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    return verdictFromSession(session);
  } catch (err) {
    // Stripe answered and refused the id: no such session, so nobody paid.
    if (err instanceof Stripe.errors.StripeInvalidRequestError) return "unpaid";
    // Anything else is our problem to fix, not the customer's to absorb.
    return "unknown";
  }
}

export default async function PaidConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; session_id?: string }>;
}) {
  const { ref, session_id: sessionId } = await searchParams;

  if ((await verdictFor(sessionId)) === "unpaid") {
    redirect(ref ? `/book/confirmed?ref=${encodeURIComponent(ref)}` : "/book/confirmed");
  }

  return (
    <Section>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">
          You are booked
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Payment went through and your visit is on the calendar. Your confirmation
          is on its way by email, and we will email you again the morning before we
          come.
        </p>

        {ref && (
          <Card className="mt-8">
            <p className="text-sm text-muted">Your reference</p>
            <p className="mt-1 font-mono text-sm text-navy">{ref}</p>
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
