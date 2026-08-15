import { emailLayout, emailText, type Row } from "./layout";
import { formatLong, type ISODate } from "../dates";
import { formatCents } from "../money";
import { site } from "../site";
import { serviceTypeLabel, unitSizeLabel, type ServiceType, type UnitSize } from "../pricing";

export type Composed = { subject: string; html: string; text: string };

function compose(opts: Parameters<typeof emailLayout>[0] & { subject: string }): Composed {
  return { subject: opts.subject, html: emailLayout(opts), text: emailText(opts) };
}

/**
 * A one-time booking, paid.
 *
 * Deliberately free of any membership pitch. Adding one turns a transactional
 * email into a commercial one under CAN-SPAM, which then needs an unsubscribe
 * link and a postal address. Worth doing later, as a decision, not by drifting
 * into it here.
 */
export function oneTimeBookingEmail(params: {
  firstName: string;
  serviceType: ServiceType;
  unitSize: UnitSize;
  onDate: ISODate;
  address: string;
  amountCents: number;
}): Composed {
  const rows: Row[] = [
    { label: "Service", value: serviceTypeLabel(params.serviceType) },
    { label: "Date", value: formatLong(params.onDate) },
    { label: "Where", value: params.address },
    { label: "Apartment", value: unitSizeLabel(params.unitSize) },
    { label: "Paid", value: formatCents(params.amountCents) },
  ];

  return compose({
    subject: `Your cleaning on ${formatLong(params.onDate)}`,
    heading: `Thanks, ${params.firstName}`,
    intro: "Your cleaning is booked. Here are the details.",
    rows,
    body: [
      "We will text you the arrival window the day before. Your cleaner has the entry details you gave us, and nobody else does.",
      "If anything is wrong after we have been, tell us within 48 hours and we will come back and put it right.",
    ],
    footerNote:
      "Your receipt comes separately from Stripe, who handle the payment. We never see your card.",
  });
}

/**
 * Membership started, first payment taken.
 *
 * This is the email that has to earn the subscription. It explains the three
 * things a member gets wrong otherwise: that there are two cleanings a month,
 * that the free add-on has to be chosen rather than appearing, and that it
 * does not roll over.
 */
export function membershipWelcomeEmail(params: {
  firstName: string;
  unitSize: UnitSize;
  monthlyAmountCents: number;
  firstPaymentCents: number;
  visitDates: ISODate[];
  address: string;
}): Composed {
  const rows: Row[] = [
    { label: "Membership", value: unitSizeLabel(params.unitSize) },
    { label: "Paid today", value: formatCents(params.firstPaymentCents) },
    { label: "Then monthly", value: formatCents(params.monthlyAmountCents) },
    { label: "Where", value: params.address },
  ];

  for (const [i, date] of params.visitDates.slice(0, 2).entries()) {
    rows.push({ label: i === 0 ? "First clean" : "Then", value: formatLong(date) });
  }

  return compose({
    subject: `Welcome to Homewick, ${params.firstName}`,
    heading: `Welcome, ${params.firstName}`,
    intro:
      "Your membership is active and your first cleanings are booked. One charge a month, two cleanings, nothing to arrange in between.",
    rows,
    body: [
      "<strong>Your free add-on.</strong> Every month you can add one extra job — inside the oven, the fridge, interior windows, or the balcony — at no cost. It is not automatic: choose it in your account so it reaches your cleaner as part of the job.",
      "It resets each month and does not carry over, so it is worth picking one each time.",
      "Two cleanings a month, roughly a fortnight apart, on the weekday you chose. Need to move one? Get in touch and we will shift it within the month.",
    ],
    cta: { label: "Choose this month's free add-on", url: `${site.url}/account` },
    footerNote:
      "Receipts and card changes are handled by Stripe. To cancel, get in touch — membership needs 14 days' notice and we will confirm your end date.",
  });
}
