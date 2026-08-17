import { sendEmail } from "./email";
import { site } from "./site";

/**
 * Tell the operator something broke in a way that costs money.
 *
 * Deliberately not a monitoring service. There are exactly two failures in
 * this product that are worth waking somebody for, both of them the same
 * shape: the customer has been told in writing that something happened, and
 * it did not. A cancellation that never reached Stripe, and a rate change
 * that never reached Stripe. Both end in a charge the customer disputes.
 *
 * Vercel keeps logs but nothing pushes them, so an operator finds out weeks
 * later from a chargeback. Email already works here, is already read, and
 * arrives on a phone. A dashboard nobody opens is not an alert.
 *
 * Never throws. An alert that fails must not take down the thing it was
 * reporting on, which would turn a recoverable problem into a broken page.
 */
export async function alertOwner(subject: string, body: string): Promise<void> {
  if (!site.ownerEmail) {
    console.error(`[alert] ${subject}\n${body}`);
    return;
  }

  try {
    await sendEmail({
      to: site.ownerEmail,
      subject: `Homewick needs a look: ${subject}`,
      text: `${body}\n\nThis is an automatic alert from the Homewick site.`,
    });
  } catch (err) {
    // Both the alert and its failure go to the log, which is all that is left.
    console.error(`[alert] could not send: ${subject}`, err);
    console.error(`[alert] ${body}`);
  }
}
