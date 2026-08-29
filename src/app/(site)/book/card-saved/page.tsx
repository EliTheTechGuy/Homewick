import type { Metadata } from "next";
import { ButtonLink, Section } from "@/components/ui";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Card saved",
  robots: { index: false, follow: false },
};

/**
 * Where Stripe drops somebody after they save a card.
 *
 * Deliberately says nothing about the booking. The paid confirmation page can
 * print an address because it has a Stripe session id to check against, and
 * this redirect carries only a visit id: anybody who guessed one could read
 * back a stranger's address. There is nothing here worth that risk, because
 * the customer already knows what they booked and what they need told is what
 * happens to their money.
 *
 * No database read either, which means it cannot contradict itself. Stripe
 * only sends anyone here after the card is actually saved, while our own
 * record of it arrives moments later by webhook. Checking would occasionally
 * tell somebody it had not worked when it had.
 */
export default async function CardSavedPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const { canceled } = await searchParams;

  if (canceled) {
    return (
      <Section>
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold text-navy md:text-4xl">
            No card saved
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            You closed the page before the card went in, so nothing was saved and
            nothing has been charged.
          </p>
          <p className="mt-4 leading-relaxed text-body">
            Your cleaning is still booked. Use the link in your email when you are
            ready, and if it has expired just ask us and we will send another.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/">Back to home</ButtonLink>
            {site.email && (
              <ButtonLink href={`mailto:${site.email}`} variant="secondary">
                Email us
              </ButtonLink>
            )}
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">
          Your card is saved
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Nothing has been charged. Your cleaning is booked and you are all set.
        </p>

        <div className="mt-8 rounded-2xl bg-panel p-5">
          <h2 className="text-sm font-semibold text-navy">What happens next</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-body">
            <li>A reminder by email the morning before your clean.</li>
            <li>
              We take the payment on the morning of your clean, for the amount in
              your booking email, and Stripe sends you a receipt straight away.
            </li>
            <li>Nothing repeats. This is a single visit and there is nothing to cancel.</li>
          </ul>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-muted">
          Your card is held by Stripe, who handle the payment. We never see it, and
          it is only used for this cleaning.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/">Back to home</ButtonLink>
          {site.email && (
            <ButtonLink href={`mailto:${site.email}`} variant="secondary">
              Email us
            </ButtonLink>
          )}
        </div>
      </div>
    </Section>
  );
}
