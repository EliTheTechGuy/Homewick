import { emailLayout, emailText, type Row } from "./layout";
import { formatLong, today, type ISODate } from "../dates";
import type { CancellationTier } from "../cancellation";
import { formatCents } from "../money";
import { site } from "../site";
import { serviceTypeLabel, unitSizeLabel, type ServiceType, type UnitSize } from "../pricing";
import { cadenceLabel } from "../cadence";

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
  /** Already formatted: a bracket for an apartment, a shape for a house. */
  property: string;
  onDate: ISODate;
  address: string;
  amountCents: number;
}): Composed {
  const rows: Row[] = [
    { label: "Service", value: serviceTypeLabel(params.serviceType) },
    { label: "Date", value: formatLong(params.onDate) },
    { label: "Where", value: params.address },
    { label: "Property", value: params.property },
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
  /**
   * Normally "tomorrow". Falls back to "today" when a reminder is going out on
   * the morning itself, which happens if the previous day's run failed. Saying
   * "tomorrow" then would send somebody out on the wrong day.
   */
  when?: "today" | "tomorrow";
}): Composed {
  const when = params.when ?? "tomorrow";
  const rows: Row[] = [
    { label: when === "today" ? "Today" : "Tomorrow", value: formatLong(params.onDate) },
    { label: "Where", value: params.address },
  ];

  if (params.freeAddOnName) {
    rows.push({ label: "Included this visit", value: params.freeAddOnName });
  }

  return compose({
    subject: `Your cleaning is ${when}, ${formatLong(params.onDate)}`,
    heading: `Your cleaning is ${when}`,
    intro: `Hi ${params.firstName}. A quick reminder so nothing catches you out.`,
    rows,
    body: [
      "Please make sure we can get in, and that the entry details you gave us are still current. If a code has changed, let us know today.",
      "It helps if floors are clear of anything that needs putting away first, though we will work around whatever is there.",
    ],
    footerNote:
      when === "today"
        ? "Need to move this one? Get in touch as soon as you can and we will find another slot."
        : "Need to move this one? Get in touch today and we will find another slot.",
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
  /**
   * This is the one message nobody asked for, so it is the one that carries a
   * way out. Kept off the others deliberately: unsubscribing from a visit
   * reminder means not knowing a cleaner is coming.
   */
  unsubscribeUrl?: string;
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
    unsubscribeUrl: params.unsubscribeUrl,
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
  // The ends are labelled instead of the scale being explained. "5 being
  // great" asks somebody to hold a rule in their head and then apply it,
  // which is a step between them and the tap. A word under each end is read
  // rather than decoded.
  //
  // Laid out as a table because a flex row is not a thing Outlook has heard
  // of, and this is the only part of the message that has to survive intact.
  const scale = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px">
    <tr>${[1, 2, 3, 4, 5]
      .map(
        (n) =>
          `<td align="center" style="padding-right:8px"><a href="${params.feedbackUrl}?rating=${n}" style="display:inline-block;width:44px;padding:11px 0;border:1px solid #1F5FA6;border-radius:999px;font:600 15px -apple-system,'Helvetica Neue',Arial,sans-serif;color:#1F5FA6;text-decoration:none;">${n}</a></td>`,
      )
      .join("")}</tr>
    <tr>${[1, 2, 3, 4, 5]
      .map((n) => {
        const label = n === 1 ? "Not great" : n === 5 ? "Great" : "";
        return `<td align="center" style="padding:6px 8px 0 0;font:400 12px -apple-system,'Helvetica Neue',Arial,sans-serif;color:#5A6B7C;white-space:nowrap;">${label}</td>`;
      })
      .join("")}</tr>
  </table>`;

  return compose({
    subject: "How did we do?",
    heading: "How did we do?",
    // "today" on the normal path, which is sent a few hours after the visit
    // and is the whole point of sending it then. The daily sweep can catch a
    // visit from several days ago, and telling somebody we cleaned today when
    // we did not is a small lie that costs the rest of the message.
    intro:
      params.onDate === today()
        ? `Hi ${params.firstName}. We cleaned your place today. How did it go?`
        : `Hi ${params.firstName}. We cleaned your place on ${formatLong(params.onDate)}. How did it go?`,
    body: [
      scale,
      "One tap is enough, and there is room to say more on the next page if you want to.",
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
 * A one-time clean called off, and what happened to the money.
 *
 * The refund is the point of the message. Somebody who cancels and hears
 * nothing assumes they have been charged for nothing, and the next thing that
 * happens is a chargeback rather than a question.
 *
 * The fee is stated with its reason rather than deducted quietly. A number
 * that appears on a card statement with no explanation attached to it is how
 * an ordinary cancellation becomes a dispute.
 */
export function visitCanceledEmail(params: {
  firstName: string;
  serviceType: ServiceType;
  /**
   * The local calendar date, formatted by Postgres rather than converted here.
   * A timestamp turned into a date in JavaScript is how 9am became 4am in this
   * codebase once already.
   */
  onDate: ISODate;
  refundCents: number;
  feeCents: number;
  tier: CancellationTier;
}): Composed {
  const rows: Row[] = [
    { label: "Was booked for", value: formatLong(params.onDate) },
    { label: "Service", value: serviceTypeLabel(params.serviceType) },
  ];

  if (params.feeCents > 0) {
    rows.push({ label: "Late cancellation fee", value: formatCents(params.feeCents) });
  }
  rows.push({
    label: "Refund",
    value: params.refundCents > 0 ? formatCents(params.refundCents) : "None",
  });

  const body: string[] = [];
  if (params.refundCents > 0) {
    body.push(
      "The refund goes back to the card you paid with. Banks usually take a few working days to show it, and it may appear as a separate line rather than as the original charge disappearing.",
    );
  }

  // The reason travels with the number. A deduction that turns up on a
  // statement with nothing attached to it is how an ordinary cancellation
  // becomes a call to the bank instead of a call to us.
  if (params.tier === "half") {
    body.push(
      `Half the price is kept when a clean is called off inside 48 hours. By then the day is set aside and a cleaner has usually been told to be there. Cancel more than 48 hours ahead and there is no fee at all.`,
    );
  }
  if (params.tier === "full") {
    body.push(
      "Inside 24 hours a cleaning is not refunded. The cleaner is already booked for it and the slot cannot be filled that late, so it is paid for either way.",
    );
    body.push(
      "If you think that is wrong in this case, get in touch and tell us what happened. We would rather hear it from you.",
    );
  }

  body.push("Book again whenever you like. Nothing here stops you.");

  return compose({
    subject: "Your cleaning is cancelled",
    heading: `That is cancelled, ${params.firstName}`,
    intro:
      "We have taken it off the schedule and nobody will be turning up. Here is where it leaves things.",
    rows,
    body,
    cta: { label: "Book another clean", url: `${site.url}/book` },
    footerNote:
      "If you did not ask for this, get in touch straight away and we will put it back.",
  });
}

/**
 * A booking entered by hand in admin, waiting on the customer's card.
 *
 * Admin used to be handed the raw Stripe URL to copy and forward itself. That
 * is a live payment link, and it ended up in a clipboard and then in whatever
 * text thread or email the operator happened to use, formatted as a wall of
 * characters that looks exactly like something you should not click.
 *
 * Sent from us instead, so it arrives looking like the rest of our mail and
 * says what was agreed on the phone before it asks for a card.
 *
 * The deadline is stated because Stripe gives these sessions 24 hours and
 * will not allow longer. Somebody who opens it on Sunday needs to know why it
 * no longer works, and who to ask.
 */
export function paymentLinkEmail(params: {
  firstName: string;
  checkoutUrl: string;
  amountCents: number;
  serviceType: ServiceType;
  startsOn: ISODate;
  address: string;
  /** Null for a single visit. Otherwise how many days between cleanings. */
  intervalDays: number | null;
  recurring: boolean;
}): Composed {
  const price = formatCents(params.amountCents);

  const rows: Row[] = [
    { label: "Service", value: serviceTypeLabel(params.serviceType) },
    { label: "First clean", value: formatLong(params.startsOn) },
    { label: "Where", value: params.address },
    {
      label: params.recurring ? "Price" : "Total",
      value: params.recurring ? `${price} ${cadenceLabel(params.intervalDays)}` : price,
    },
  ];

  return compose({
    subject: "Your Homewick booking, ready to confirm",
    heading: `Almost there, ${params.firstName}`,
    intro:
      "Here is the cleaning we set up for you. One card entry and it is booked.",
    rows,
    body: [
      "Nothing is on the schedule until the payment goes through, so the date above is not held yet.",
      params.recurring
        ? "After that it runs on its own. You are billed and cleaned on the same rhythm, and you can stop with 14 days' notice whenever you like."
        : "This is a single visit. There is nothing recurring and nothing to cancel afterwards.",
      "The link is good for 24 hours. If it has stopped working by the time you get to it, get in touch and we will send a fresh one.",
    ],
    cta: { label: "Confirm and pay", url: params.checkoutUrl },
    footerNote:
      "Your card is entered with Stripe, who handle the payment. We never see it.",
  });
}

/**
 * The morning the membership is actually over.
 *
 * The cancellation email goes out the day somebody cancels, and by then the
 * end date can be six weeks away. Everything it said is forgotten by the time
 * it happens, so the last cleaning comes and goes and nothing marks the end.
 *
 * This is the one that says it is done and asks whether they want us back. It
 * is a commercial message rather than a receipt, which is why it carries an
 * unsubscribe link and why the opt-out is honoured before it is sent.
 *
 * Kept short. It closes something off warmly and makes coming back easy, and
 * anything more reads as trying to talk somebody out of a decision they have
 * already made.
 */
export function membershipEndedEmail(params: {
  firstName: string;
  endedOn: ISODate;
  lastVisit: ISODate | null;
  unsubscribeUrl?: string;
}): Composed {
  const rows: Row[] = [
    { label: "Membership ended", value: formatLong(params.endedOn) },
  ];
  if (params.lastVisit) {
    rows.push({ label: "Last cleaning", value: formatLong(params.lastVisit) });
  }

  return compose({
    subject: "Your Homewick membership has ended",
    heading: `Thanks for having us, ${params.firstName}`,
    intro:
      "Your membership has come to an end and there is nothing further to pay. It was good to look after your place.",
    rows,
    body: [
      "If you would like us back, you can start again whenever it suits. Once a month or twice a month, whichever fits how you actually use the place.",
      "One-time cleans are always there too, at the published rate, with no membership involved.",
    ],
    cta: { label: "Start a new membership", url: `${site.url}/membership` },
    // Not "just reply". The layout footer says plainly that replies are not
    // read, and an email that contradicts its own footer two lines later is
    // how you teach somebody to ignore both.
    footerNote:
      "If something went wrong and that is why you left, we would genuinely like to know. The address below comes straight to us.",
    unsubscribeUrl: params.unsubscribeUrl,
  });
}

/**
 * Membership started, first payment taken.
 *
 * This is the email that has to earn the subscription. It explains the things
 * a member gets wrong otherwise: how many cleanings a month they have, that
 * the free add-on has to be chosen rather than appearing, and that nothing
 * rolls over.
 *
 * Written from the tier rather than around it. The previous version said "two
 * cleanings" and "your free add-on" in fixed text, which for a once-a-month
 * member would have promised a second visit that is never booked and an
 * add-on they do not have. A welcome email that opens by describing somebody
 * else's membership is worse than no welcome email.
 */
export function membershipWelcomeEmail(params: {
  firstName: string;
  /** Already formatted: a bracket for an apartment, a shape for a house. */
  property: string;
  visitsPerPeriod: number;
  freeAddOn: boolean;
  monthlyAmountCents: number;
  /**
   * Days between charges, or null for the published monthly membership.
   *
   * Without this the email said "a month" to everybody, which for somebody on
   * a 21 day cadence is seventeen charges a year described as twelve. The
   * account page was fixed for this and the welcome email was not, so the very
   * first thing a hand-entered customer read was the wrong number.
   */
  intervalDays: number | null;
  firstPaymentCents: number;
  visitDates: ISODate[];
  address: string;
}): Composed {
  const cleanings =
    params.visitsPerPeriod === 1 ? "one cleaning" : `${params.visitsPerPeriod} cleanings`;
  // "a month", "every 3 weeks", whatever they were actually signed up for.
  const cadence = cadenceLabel(params.intervalDays);

  const rows: Row[] = [
    { label: "Membership", value: params.property },
    { label: "Paid today", value: formatCents(params.firstPaymentCents) },
    {
      label: "Then",
      value: `${formatCents(params.monthlyAmountCents)} ${cadenceLabel(params.intervalDays)}`,
    },
    { label: "Where", value: params.address },
  ];

  for (const [i, date] of params.visitDates
    .slice(0, params.visitsPerPeriod)
    .entries()) {
    rows.push({ label: i === 0 ? "First clean" : "Then", value: formatLong(date) });
  }

  const body = params.freeAddOn
    ? [
        "<strong>Your free add-on.</strong> Every month you can add one extra job at no cost. Inside the oven, the fridge, interior windows, or the balcony. It is not automatic, so choose it in your account and it will reach your cleaner as part of the job.",
        "It resets each month and does not carry over, so it is worth picking one each time.",
        `${cleanings.charAt(0).toUpperCase()}${cleanings.slice(1)} ${cadence}, roughly a fortnight apart, on the weekday you chose. Need to move one? Get in touch and we will shift it within your billing period.`,
      ]
    : [
        `<strong>Your cleaning day.</strong> One clean ${cadence}, on the weekday you chose. Need to move it? Get in touch and we will shift it within your billing period.`,
        "It does not carry over, so a period you skip is a period gone rather than two cleans banked for later.",
        "Add-ons are 10% off for members, and you can add one to any visit from your account.",
      ];

  return compose({
    subject: `Welcome to Homewick, ${params.firstName}`,
    heading: `Welcome, ${params.firstName}`,
    intro: `Your membership is active and your ${params.visitsPerPeriod === 1 ? "first cleaning is" : "first cleanings are"} booked. One charge ${cadence}, ${cleanings}, nothing to arrange in between.`,
    rows,
    body,
    cta: params.freeAddOn
      ? { label: "Choose this month's free add-on", url: `${site.url}/account` }
      : { label: "See your cleanings", url: `${site.url}/account` },
    footerNote:
      "Receipts and card changes are handled by Stripe. To cancel, get in touch. Membership needs 14 days' notice and we will confirm your end date.",
  });
}

/**
 * A new paid booking, sent to the operator rather than the customer.
 *
 * The admin board only tells you what is happening if you are looking at it,
 * and nobody watches a dashboard all day. This is the nudge that says a job
 * arrived and needs a cleaner against it.
 *
 * Sent on payment, not on submission, so an abandoned checkout never pages
 * anyone. Everything needed to act is in the message itself: what, where,
 * when, and whether anything unusual came with it.
 */
export function newBookingAlertEmail(params: {
  kind: "membership" | "one_time";
  customerName: string;
  customerPhone: string;
  serviceType: ServiceType;
  /** Already formatted: a bracket for an apartment, a shape for a house. */
  property: string;
  onDate: ISODate;
  address: string;
  amountCents: number;
  hasPets: boolean;
  addOns: string[];
  instructions: string | null;
  adminUrl: string;
}): Composed {
  const rows: Row[] = [
    {
      label: "Booking",
      value:
        params.kind === "membership"
          ? "New membership, first clean below"
          : "One-time clean",
    },
    { label: "When", value: formatLong(params.onDate) },
    { label: "Where", value: params.address },
    { label: "Property", value: params.property },
    { label: "Service", value: serviceTypeLabel(params.serviceType) },
    { label: "Customer", value: `${params.customerName}, ${params.customerPhone}` },
    { label: "Paid", value: formatCents(params.amountCents) },
  ];

  if (params.hasPets) rows.push({ label: "Pets", value: "Yes, at this address" });
  if (params.addOns.length > 0) {
    rows.push({ label: "Add-ons", value: params.addOns.join(", ") });
  }

  const body: string[] = [];
  if (params.instructions) {
    body.push(`<strong>They said:</strong> ${escapeText(params.instructions)}`);
  }
  body.push(
    params.kind === "membership"
      ? "This is a recurring member, so their second clean of the month is already on the board too."
      : "One-time booking, so there is nothing recurring to set up.",
  );

  return compose({
    subject: `New ${params.kind === "membership" ? "membership" : "booking"}: ${params.customerName}, ${formatLong(params.onDate)}`,
    heading: "You have a new booking",
    intro: `${params.customerName} has paid and is on the board for ${formatLong(params.onDate)}.`,
    rows,
    body,
    cta: { label: "Open the day in admin", url: params.adminUrl },
    footerNote:
      "You are getting this because you run Homewick. Entry details are never included here; they stay in admin and are only revealed on the day.",
  });
}

/**
 * Customer text pasted into an operator email.
 *
 * Instructions are typed by the public, and the layout renders intro and body
 * as HTML so a stray angle bracket would otherwise break the message.
 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The job, sent to the cleaner who has been put on it.
 *
 * Cleaners have no account, so this email is the entire interface: it has to
 * carry everything needed to turn up prepared.
 *
 * Everything except the entry code. That sits behind the link, which only
 * opens on the day and records who looked. A door code in an inbox is
 * readable by anyone who ever gets into that inbox, stays readable after the
 * person stops working here, and leaves no trace of having been read.
 */
export function cleanerAssignmentEmail(params: {
  reason: "assigned" | "moved";
  cleanerFirstName: string;
  customerName: string;
  customerPhone: string;
  serviceType: ServiceType;
  /** Already formatted: a bracket for an apartment, a shape for a house. */
  property: string;
  onDate: ISODate;
  atTime: string;
  address: string;
  hasPets: boolean;
  addOns: string[];
  instructions: string | null;
  jobUrl: string;
  hasEntryDetails: boolean;
  /** How many things this service covers, so they know the size before they go. */
  checklistCount: number;
}): Composed {
  const moved = params.reason === "moved";

  const rows: Row[] = [
    { label: "When", value: `${formatLong(params.onDate)}, ${params.atTime}` },
    { label: "Where", value: params.address },
    { label: "Property", value: params.property },
    { label: "Job", value: serviceTypeLabel(params.serviceType) },
    { label: "Customer", value: `${params.customerName}, ${params.customerPhone}` },
  ];

  if (params.hasPets) rows.push({ label: "Pets", value: "Yes, at this address" });
  if (params.addOns.length > 0) {
    rows.push({ label: "Also included", value: params.addOns.join(", ") });
  }
  // The count, not the list. Forty-four lines in an email is a wall nobody
  // reads, and the list belongs on the page they have open while working
  // rather than in a message they read once on the way there.
  if (params.checklistCount > 0) {
    rows.push({
      label: "Checklist",
      value: `${params.checklistCount} things, on the job page`,
    });
  }

  const body: string[] = [];

  if (moved) {
    body.push(
      "<strong>This one has moved.</strong> The date and time above are the new ones, so please update whatever you keep your days in.",
    );
  }

  if (params.instructions) {
    body.push(
      `<strong>The customer asked:</strong> ${escapeText(params.instructions)}`,
    );
  }

  body.push(
    params.hasEntryDetails
      ? "Entry details are on the job page, and they unlock on the morning of the visit. Open it when you arrive rather than the night before."
      : "There are no entry details on file for this one, so expect to be let in.",
  );

  body.push(
    "If you cannot make it, say so as early as you can so it can be moved to somebody else.",
  );

  return compose({
    subject: moved
      ? `Moved: ${params.customerName}, now ${formatLong(params.onDate)}`
      : `New job: ${params.customerName}, ${formatLong(params.onDate)}`,
    heading: moved ? "A job has moved" : `Hi ${params.cleanerFirstName}, new job`,
    intro: moved
      ? `${params.customerName}'s clean has been rescheduled. Here are the new details.`
      : `You are on this one. Everything you need is below.`,
    rows,
    body,
    cta: { label: "Open the job", url: params.jobUrl },
    footerNote:
      "This link is yours; it opens the job and shows entry details on the day. Do not forward it.",
  });
}

/**
 * A cleaning moved, sent to the operator.
 *
 * Members can move their own cleanings, which is the point of the feature, but
 * it means the board can change without anybody being told. A cleaner may
 * already have been sent the old date, and a day that was covered may now have
 * a gap in it.
 */
export function visitMovedAlertEmail(params: {
  customerName: string;
  customerPhone: string;
  fromDate: ISODate;
  toDate: ISODate;
  address: string;
  cleanerName: string | null;
  adminUrl: string;
}): Composed {
  const rows: Row[] = [
    { label: "Was", value: formatLong(params.fromDate) },
    { label: "Now", value: formatLong(params.toDate) },
    { label: "Where", value: params.address },
    { label: "Customer", value: `${params.customerName}, ${params.customerPhone}` },
    {
      label: "Cleaner",
      value: params.cleanerName ?? "Nobody assigned",
    },
  ];

  return compose({
    subject: `Moved: ${params.customerName}, ${formatLong(params.fromDate)} to ${formatLong(params.toDate)}`,
    heading: "A cleaning has moved",
    intro: `${params.customerName} moved their clean from ${formatLong(params.fromDate)} to ${formatLong(params.toDate)}.`,
    rows,
    body: [
      params.cleanerName
        ? `${params.cleanerName} was on this one and has been emailed the new date.`
        : "Nobody is assigned to this yet, so there is nothing to tell anyone.",
      "The old day may now have a gap in it, and the new day may need looking at.",
    ],
    cta: { label: "Open the new day", url: params.adminUrl },
  });
}
