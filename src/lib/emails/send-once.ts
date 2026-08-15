import { queryOne } from "../db";
import { sendEmail } from "../email";
import type { Composed } from "./templates";

/**
 * Send a transactional email at most once for a given cause.
 *
 * Stripe retries a webhook until it gets a 2xx and may deliver the same event
 * more than once regardless, so the naive version sends a second "welcome to
 * your membership". The insert claims the right to send: if the row already
 * exists, another delivery of the same event got there first and we stop.
 *
 * Claiming before sending rather than after means a crash mid-send loses an
 * email rather than sending two. For a welcome that is the better failure —
 * a missing one is a support question, a duplicate looks like a double charge.
 */
export async function sendOnce(params: {
  eventKey: string;
  kind: string;
  to: string;
  customerId: string | null;
  message: Composed;
}): Promise<{ sent: boolean; reason?: "already_sent" | "not_delivered" }> {
  const claim = await queryOne<{ id: string }>(
    `insert into email_deliveries (event_key, kind, customer_id, recipient)
     values ($1, $2, $3, $4)
     on conflict (event_key, kind) do nothing
     returning id`,
    [params.eventKey, params.kind, params.customerId, params.to],
  );

  if (!claim) {
    console.info(`[email] ${params.kind} already sent for ${params.eventKey}`);
    return { sent: false, reason: "already_sent" };
  }

  const { delivered } = await sendEmail({
    to: params.to,
    subject: params.message.subject,
    text: params.message.text,
    html: params.message.html,
  });

  await queryOne(`update email_deliveries set delivered = $2 where id = $1 returning id`, [
    claim.id,
    delivered,
  ]);

  return delivered ? { sent: true } : { sent: false, reason: "not_delivered" };
}
