/**
 * Did this checkout actually get paid?
 *
 * The answer decides whether a conversion is reported to Google, so it has to
 * be honest in both directions. Counting a payment that did not happen makes
 * ad spend look better than it is. Refusing to count one that did makes it
 * look worse, and worse than that, it means telling a paying customer that
 * nothing was charged.
 *
 * So there are three answers, not two. "unknown" exists because our own
 * failure to reach Stripe is not evidence about the customer's payment.
 */
export type PaymentVerdict = "paid" | "unpaid" | "unknown";

type SessionLike = {
  payment_status?: string | null;
  status?: string | null;
};

export function verdictFromSession(session: SessionLike | null): PaymentVerdict {
  if (!session) return "unknown";

  switch (session.payment_status) {
    case "paid":
      return "paid";
    // A full-value coupon leaves nothing to charge. They still converted, and
    // for a first month at 100% off that is exactly the campaign working.
    case "no_payment_required":
      return "paid";
    case "unpaid":
      // An open session is somebody who has not finished yet, which is not the
      // same as somebody who tried and failed. Neither counts as a conversion.
      return "unpaid";
    default:
      return "unknown";
  }
}
