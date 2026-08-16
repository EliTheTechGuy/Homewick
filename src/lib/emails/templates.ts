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
      "We will email you a reminder the morning before. Your cleaner has the entry details you gave us, and nobody else does.",
      "If anything is wrong after we have been, tell us within 48 hours and we will come back and put it right.",
    ],
    footerNote:
      "Your receipt comes separately from Stripe, who handle the payment. We never see your card.",
  });
}

/**
 * The day before a cleaning.
 *
 * Sent to everyone, member or not. The job it does is practical rather than
 * promotional: a visit nobody remembered is a visit where access fails, and a
 * wasted trip costs a cleaner's time whether or not the customer was at fault.
 */
export function visitReminderEmail(params: {
  firstName: string;
  onDate: ISODate;
  address: string;
  freeAddOnName: string | null;
}): Composed {
  const rows: Row[] = [
    { label: "Tomorrow", value: formatLong(params.onDate) },
    { label: "Where", value: params.address },
  ];

  if (params.freeAddOnName) {
    rows.push({ label: "Included this visit", value: params.freeAddOnName });
  }

  return compose({
    subject: `Your cleaning is tomorrow, ${formatLong(params.onDate)}`,
    heading: "Your cleaning is tomorrow",
    intro: `Hi ${params.firstName}. A quick reminder so nothing catches you out tomorrow.`,
    rows,
    body: [
      "Please make sure we can get in, and that the entry details you gave us are still current. If a code has changed, let us know today.",
      "It helps if floors are clear of anything that needs putting away first, though we will work around whatever is there.",
    ],
    footerNote:
      "Need to move this one? Get in touch today and we will find another slot.",
  });
}

/**
 * A nudge, a couple of days into each billing period, when the free add-on is
 * still unclaimed.
 *
 * Without it almost nobody claims the perk, because claiming requires
 * remembering that it exists. That turns a benefit you are paying for into one
 * the member never feels, which is the worst of both.
 */
export function freeAddOnNudgeEmail(params: {
  firstName: string;
  nextVisitDate: ISODate;
}): Composed {
  return compose({
    subject: "Your free add-on this month",
    heading: "Pick your free add-on",
    intro: `Hi ${params.firstName}. Your free add-on for this month is still waiting, and your next cleaning is ${formatLong(params.nextVisitDate)}.`,
    body: [
      "Choose one extra job at no cost. Inside the oven, inside the fridge, interior windows, or the balcony.",
      "It takes a moment, and picking it now means your cleaner arrives knowing to do it. It resets at the start of each month and does not carry over.",
    ],
    cta: { label: "Choose my free add-on", url: `${site.url}/account` },
  });
}

/**
 * How did we do, sent the morning after a clean.
 *
 * The rating drives service recovery and nothing else. Every customer gets the
 * same public review link on the thank you page whatever they score, because
 * steering only happy customers toward a review breaches Google's policies
 * and the FTC's 2024 rule on suppressing negative feedback. The score decides
 * whether we chase the problem, never who is invited to review us.
 *
 * The stars are links so a reply costs one tap. They open a page, they do not
 * record anything, so a mail scanner following them cannot submit a rating.
 */
export function feedbackRequestEmail(params: {
  firstName: string;
  onDate: ISODate;
  feedbackUrl: string;
}): Composed {
  const stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<a href="${params.feedbackUrl}?rating=${n}" style="display:inline-block;padding:10px 16px;margin:0 4px 8px 0;border:1px solid #1F5FA6;border-radius:999px;font:600 15px -apple-system,'Helvetica Neue',Arial,sans-serif;color:#1F5FA6;text-decoration:none;">${n}</a>`,
    )
    .join("");

  return compose({
    subject: "How did we do?",
    heading: "How did we do?",
    intro: `Hi ${params.firstName}. We cleaned your place on ${formatLong(params.onDate)}. Tap a number, 5 being great.`,
    body: [
      `<div style="margin:6px 0 4px">${stars}</div>`,
      "It takes one tap, and there is room to say more on the next page if you want to.",
      "If anything was not right, tell us within 48 hours and we will come back and redo it at no charge.",
    ],
  });
}

/**
 * Cancellation acknowledged.
 *
 * The end date is the whole point. A member who cancels and is then charged
 * again, or who assumes a booked cleaning is gone when it is not, has a
 * dispute rather than a question. Putting the date and the remaining visits in
 * writing settles both before they arise.
 */
export function cancellationConfirmedEmail(params: {
  firstName: string;
  endsOn: ISODate;
  remainingVisits: ISODate[];
}): Composed {
  const rows: Row[] = [
    { label: "Membership ends", value: formatLong(params.endsOn) },
    { label: "Last charge", value: "Already taken. There will be no further charges." },
  ];

  for (const [i, date] of params.remainingVisits.slice(0, 3).entries()) {
    rows.push({
      label: i === 0 ? "Cleanings still booked" : " ",
      value: formatLong(date),
    });
  }

  return compose({
    subject: "Your membership has been cancelled",
    heading: "That is all sorted",
    intro: `Thanks ${params.firstName}. Your membership will end on ${formatLong(params.endsOn)}, and you will not be charged again.`,
    rows,
    body: [
      params.remainingVisits.length > 0
        ? "The cleanings listed above are already paid for and still going ahead. Nothing changes about them."
        : "You have no cleanings left to run, so there is nothing further to arrange.",
      "If you change your mind before that date, get in touch and we can pick things up again without you losing anything.",
    ],
    footerNote:
      "You can still book a one-time clean any time, at the standard rate.",
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
      "<strong>Your free add-on.</strong> Every month you can add one extra job at no cost. Inside the oven, the fridge, interior windows, or the balcony. It is not automatic, so choose it in your account and it will reach your cleaner as part of the job.",
      "It resets each month and does not carry over, so it is worth picking one each time.",
      "Two cleanings a month, roughly a fortnight apart, on the weekday you chose. Need to move one? Get in touch and we will shift it within the month.",
    ],
    cta: { label: "Choose this month's free add-on", url: `${site.url}/account` },
    footerNote:
      "Receipts and card changes are handled by Stripe. To cancel, get in touch. Membership needs 14 days' notice and we will confirm your end date.",
  });
}
