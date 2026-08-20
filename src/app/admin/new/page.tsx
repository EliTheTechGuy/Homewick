import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/AdminNav";
import { ManualBookingForm } from "@/components/admin/ManualBookingForm";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "New booking",
  robots: { index: false, follow: false },
};

/**
 * For customers who did not come through the booking form: phone calls,
 * referrals, and leads from listing platforms.
 *
 * Deliberately does not take a card. It creates the record and hands back a
 * Stripe Checkout link to send, so the customer enters their own card exactly
 * as they would on the public site. Card details stay with Stripe, and the
 * booking activates through the same webhook that already handles every other
 * payment rather than a second path that would need its own proving.
 */
export default async function NewBookingPage() {
  const admin = await requireAdmin();
  if (!admin) return null;

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <AdminNav current="new" />
      <h1 className="mt-6 text-3xl font-semibold text-navy">New booking</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted">
        For somebody who called, was referred, or came from a listing site. Any
        repeat schedule is allowed, not just the published monthly membership.
      </p>
      <ManualBookingForm />
    </div>
  );
}
