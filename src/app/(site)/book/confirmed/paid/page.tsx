import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ButtonLink, Card, Section } from "@/components/ui";
import { queryOne } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { TIMEZONE } from "@/lib/dates";
import { serviceTypeLabel, unitSizeLabel, type ServiceType, type UnitSize } from "@/lib/pricing";
import { verdictFromSession, type PaymentVerdict } from "@/lib/checkout-verdict";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Booking confirmed",
  robots: { index: false, follow: false },
};

/**
 * The page a customer sees only after actually paying.
 *
 * It exists so advertising can be measured against real revenue: Google Ads
 * counts a conversion when a URL loads, so the URL has to mean one thing.
 * /book/confirmed does not, because it also catches bookings whose payment
 * could not be started at all.
 *
 * Stripe is asked whether the session was really paid, rather than trusting
 * the redirect, and the session's own metadata decides which booking to show
 * rather than the ref in the query string. Those are two different checks and
 * both are needed: the first stops an unpaid visitor seeing a success page,
 * the second stops somebody pairing their own valid session with a stranger's
 * booking id and reading back that person's address.
 *
 * The three outcomes are deliberate:
 *
 *   paid      show the booking, count the conversion
 *   unpaid    send them to the ordinary confirmation, count nothing
 *   unknown   show the page, but without the booking detail
 *
 * That last one is the argued case. If Stripe is unreachable we cannot tell,
 * and the two ways of being wrong are not equal: over-count a conversion, or
 * tell somebody who just paid that they did not. It fails towards the
 * customer, while still declining to print an address we could not verify
 * they are entitled to see.
 */
type Booking = {
  kind: "membership" | "one_time";
  service_type: ServiceType;
  on_date: string;
  at_time: string;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
  unit_size: UnitSize;
  has_pets: boolean;
  instructions: string | null;
  add_ons: string[] | null;
};

async function resolve(
  sessionId: string | undefined,
): Promise<{ verdict: PaymentVerdict; bookingRef: string | null }> {
  // No id at all means this was typed or crawled rather than redirected.
  if (!sessionId) return { verdict: "unpaid", bookingRef: null };

  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    const verdict = verdictFromSession(session);
    // The booking comes from Stripe's copy of the metadata, never from the
    // query string, so the URL cannot be edited to point at another booking.
    const ref =
      session.metadata?.visit_id ?? session.metadata?.subscription_id ?? null;
    return { verdict, bookingRef: ref };
  } catch (err) {
    // Stripe answered and refused the id: no such session, so nobody paid.
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      return { verdict: "unpaid", bookingRef: null };
    }
    // Anything else is our problem to fix, not the customer's to absorb.
    return { verdict: "unknown", bookingRef: null };
  }
}

async function loadBooking(ref: string): Promise<Booking | null> {
  return queryOne<Booking>(
    `select
        case when v.subscription_id is null then 'one_time' else 'membership' end as kind,
        v.service_type::text as service_type,
        (v.scheduled_for at time zone $2)::date::text as on_date,
        to_char(v.scheduled_for at time zone $2, 'FMHH12:MI am') as at_time,
        p.line1, p.line2, p.city, p.postal_code,
        p.unit_size::text as unit_size, p.has_pets,
        v.customer_instructions as instructions,
        (select array_agg(a.name order by a.name)
           from visit_add_ons va join add_ons a on a.id = va.add_on_id
          where va.visit_id = v.id) as add_ons
       from visits v
       join properties p on p.id = v.property_id
      where (v.id = $1 or v.subscription_id = $1)
        and v.status <> 'canceled'
      order by v.scheduled_for
      limit 1`,
    [ref, TIMEZONE],
  ).catch(() => null);
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-hairline py-3 first:border-t-0 first:pt-0">
      <dt className="text-xs uppercase tracking-widest text-muted">{label}</dt>
      <dd className="mt-1 text-body">{children}</dd>
    </div>
  );
}

export default async function PaidConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; session_id?: string }>;
}) {
  const { ref, session_id: sessionId } = await searchParams;
  const { verdict, bookingRef } = await resolve(sessionId);

  if (verdict === "unpaid") {
    redirect(ref ? `/book/confirmed?ref=${encodeURIComponent(ref)}` : "/book/confirmed");
  }

  const booking = bookingRef ? await loadBooking(bookingRef) : null;

  return (
    <Section>
      <div className="grid max-w-5xl gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div>
          <h1 className="text-3xl font-semibold text-navy md:text-4xl">You are booked</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            {booking?.kind === "membership"
              ? "Payment went through and your membership is live. Your first clean is on the calendar, and we will email you the morning before we come."
              : "Payment went through and your visit is on the calendar. Your confirmation is on its way by email, and we will email you again the morning before we come."}
          </p>

          {booking && (
            <Card className="mt-8">
              <dl>
                <Detail label="Service">
                  {serviceTypeLabel(booking.service_type)}
                  {booking.kind === "membership" && (
                    <span className="text-muted"> · first clean of your membership</span>
                  )}
                </Detail>
                <Detail label="When">
                  {new Date(`${booking.on_date}T12:00:00`).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                  <span className="text-muted"> from {booking.at_time}</span>
                </Detail>
                <Detail label="Where">
                  {booking.line1}
                  {booking.line2 ? `, ${booking.line2}` : ""}
                  <br />
                  <span className="text-muted">
                    {booking.city}, TX {booking.postal_code} · {unitSizeLabel(booking.unit_size)}
                  </span>
                </Detail>
                {booking.add_ons && booking.add_ons.length > 0 && (
                  <Detail label="Add-ons">{booking.add_ons.join(", ")}</Detail>
                )}
                {booking.has_pets && <Detail label="Pets">We know to expect them</Detail>}
                {booking.instructions && (
                  <Detail label="Your notes">{booking.instructions}</Detail>
                )}
              </dl>
            </Card>
          )}

          <div className="mt-8 rounded-2xl bg-panel p-5">
            <h2 className="text-sm font-semibold text-navy">What happens next</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-body">
              <li>A confirmation email, with everything above, in the next few minutes.</li>
              <li>A reminder the morning before your clean.</li>
              <li>
                {booking?.kind === "membership"
                  ? "Your second clean of the month is already scheduled, and you can move either one from your account."
                  : "Need to move it? Reply to the confirmation email and we will sort it."}
              </li>
            </ul>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/account">Go to my account</ButtonLink>
            <ButtonLink href="/" variant="secondary">
              Back to home
            </ButtonLink>
          </div>
        </div>

        {/* Decorative, so an empty alt rather than a description a screen
            reader has to sit through on the way to the booking detail. */}
        <div className="relative hidden aspect-[4/5] overflow-hidden rounded-2xl lg:block">
          <Image
            src="/photography/living-room.jpg"
            alt=""
            fill
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>
    </Section>
  );
}
