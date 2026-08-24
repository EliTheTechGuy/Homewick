import { z } from "zod";
import {
  ADD_ONS,
  includedAddOnCodes,
  FREE_PERK_ELIGIBLE,
  MEMBERSHIP_FREQUENCIES,
  PET_SURCHARGE_CENTS,
  SERVICE_PRICES,
  firstMonthCents,
  includedInService,
  membershipTier,
  type MembershipFrequency,
} from "./pricing";
import { isISODate } from "./dates";

const unitSize = z.enum(["studio_1br", "2br_2ba", "3br_2ba"]);
const serviceType = z.enum(["standard", "deep", "move_out"]);
const addOnCodes = ADD_ONS.map((a) => a.code) as [string, ...string[]];
const freePerkCodes = FREE_PERK_ELIGIBLE.map((a) => a.code) as [string, ...string[]];

/** Whether this booking is on a tier that includes the free add-on. */
function membershipEntitlesFreeAddOn(
  plan: "one_time" | "membership",
  frequency: MembershipFrequency,
): boolean {
  return plan === "membership" && membershipTier(frequency).freeAddOn;
}

export const bookingSchema = z
  .object({
    // Contact
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email("Enter a valid email address")),
    phone: z
      .string()
      .trim()
      .min(10, "Enter a valid phone number")
      .max(20)
      .regex(/^[\d\s()+.-]+$/, "Enter a valid phone number"),

    // Property
    line1: z.string().trim().min(1, "Street address is required").max(200),
    line2: z.string().trim().max(120).optional().or(z.literal("")),
    city: z.string().trim().min(1, "City is required").max(120),
    state: z.string().trim().length(2).default("TX"),
    postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code"),

    // 1. Apartment size · 2. Service type
    unitSize,
    plan: z.enum(["one_time", "membership"]),
    /**
     * Membership only. Ignored on a one-time booking, and defaulted rather
     * than required so an older client that does not send it still gets the
     * tier it was built against instead of a validation error.
     */
    frequency: z
      .enum(MEMBERSHIP_FREQUENCIES as [MembershipFrequency, ...MembershipFrequency[]])
      .default("twice_monthly"),
    serviceType: serviceType.optional(),

    // 3. Add-ons · 4. Free perk (members only)
    addOns: z.array(z.enum(addOnCodes)).default([]),
    freePerk: z.enum(freePerkCodes).optional().or(z.literal("")),

    // 5. Pets · 6. Preferred weekday
    hasPets: z.boolean().default(false),
    preferredWeekday: z.coerce.number().int().min(0).max(6).optional(),

    // 7. Entry, routed to the encrypted secrets table, never to notes.
    //
    // "front_desk" covers buildings where a concierge lets the cleaner up, or
    // the customer is simply home. There is no code to give in that case, so
    // the detail field is optional; the other three methods are the code
    // itself, so choosing one and leaving it blank is caught below.
    entryMethod: z.enum(["door_code", "gate_code", "key_location", "front_desk"]),
    entryDetail: z.string().trim().max(400).optional().or(z.literal("")),
    alarmInstructions: z.string().trim().max(400).optional().or(z.literal("")),

    // 8. Instructions
    instructions: z.string().trim().max(2000).optional().or(z.literal("")),

    // Preferred first date, for one-time bookings
    preferredDate: z
      .string()
      .trim()
      .refine((v) => v === "" || isISODate(v), "Choose a date")
      .optional()
      .or(z.literal("")),

    // 9. SMS consent · 10. Terms
    smsConsent: z.boolean().default(false),
    acceptTerms: z.literal(true, {
      error: "You must accept the service agreement",
    }),
  })
  .superRefine((data, ctx) => {
    if (data.plan === "one_time" && !data.serviceType) {
      ctx.addIssue({
        code: "custom",
        path: ["serviceType"],
        message: "Choose a service",
      });
    }
    if (data.plan === "membership" && data.preferredWeekday === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["preferredWeekday"],
        message: "Choose a preferred day",
      });
    }
    // The free perk is a membership entitlement and must be an eligible add-on.
    // Not every tier carries it: the once-a-month rate sits a few dollars
    // under the one-time price, and a free add-on worth up to $45 on top of
    // that would make it the better deal per dollar than the tier that is
    // supposed to be the better deal.
    if (data.freePerk && !membershipEntitlesFreeAddOn(data.plan, data.frequency)) {
      ctx.addIssue({
        code: "custom",
        path: ["freePerk"],
        message:
          data.plan === "one_time"
            ? "The free add-on is a membership benefit"
            : "The free add-on comes with the twice-a-month membership",
      });
    }
    // Picking "Door code" and leaving it blank tells the cleaner nothing. The
    // front-desk option is the way to say there is no code.
    if (data.entryMethod !== "front_desk" && !data.entryDetail) {
      ctx.addIssue({
        code: "custom",
        path: ["entryDetail"],
        message: "Add the code, or choose “Someone lets us in” instead",
      });
    }
  });

export type BookingInput = z.infer<typeof bookingSchema>;

const SERVICE_LINE_LABELS: Record<"standard" | "deep" | "move_out", string> = {
  standard: "Standard clean",
  deep: "Deep clean",
  move_out: "Move-out clean",
};

/**
 * What the customer will be charged, in cents.
 *
 * A membership signup is billed as that tier's first charge and nothing else.
 * There is no separate onboarding fee: the first cleaning is one of the ones
 * the period already pays for.
 */
export type QuoteParams = {
  plan: "one_time" | "membership";
  unitSize: "studio_1br" | "2br_2ba" | "3br_2ba";
  /** Membership only. Defaults to the twice-a-month tier. */
  frequency?: MembershipFrequency;
  serviceType?: "standard" | "deep" | "move_out";
  addOns: string[];
  freePerk?: string;
  hasPets: boolean;
};

export type Quote = {
  lines: { label: string; amountCents: number }[];
  totalCents: number;
};

export function quoteBooking(input: BookingInput): Quote {
  return quoteFor(input);
}

/** Shared by the server action and the form's live estimate. */
export function quoteFor(input: QuoteParams): Quote {
  const lines: { label: string; amountCents: number }[] = [];
  const frequency = input.frequency ?? "twice_monthly";
  const tier = membershipTier(frequency);

  if (input.plan === "membership") {
    // A member pays the membership price and nothing else. The onboarding deep
    // clean is one of the first month's two cleanings, not a second charge on
    // top, billing both charged twice for the same month of service.
    //
    // Only one tier is discounted, so the label is built from the tier rather
    // than written out. A line that says 15% off next to a number that is not
    // 15% off is the kind of thing a customer notices at exactly the wrong
    // moment.
    lines.push({
      label:
        tier.firstMonthDiscount > 0
          ? `Membership, first month (${Math.round(tier.firstMonthDiscount * 100)}% off)`
          : `Membership, ${tier.label.toLowerCase()}`,
      amountCents: firstMonthCents(input.unitSize, frequency),
    });
  } else if (input.serviceType) {
    lines.push({
      label: SERVICE_LINE_LABELS[input.serviceType],
      amountCents: SERVICE_PRICES[input.unitSize][input.serviceType],
    });
  }

  // A single charge on this booking whenever the property has pets. It is
  // deliberately not repeated on later visits.
  if (input.hasPets) {
    lines.push({ label: "Pet home surcharge", amountCents: PET_SURCHARGE_CENTS });
  }

  // What the chosen service already covers is quoted whether or not it was
  // asked for, so the total and the itemised lines describe the same visit.
  // Deduped, because a fridge clean ticked before the service was switched to
  // deep must not appear twice.
  const codes = [
    ...new Set([
      ...input.addOns,
      ...includedAddOnCodes(input.serviceType),
    ]),
  ];

  for (const code of codes) {
    const addOn = ADD_ONS.find((a) => a.code === code);
    if (!addOn) continue;
    // Part of the deep clean, so it appears on the quote at nothing rather
    // than being left off it. Somebody choosing the expensive service should
    // see what that bought them.
    if (includedInService(code, input.serviceType)) {
      lines.push({ label: `${addOn.name} (included)`, amountCents: 0 });
    } else if (input.plan === "membership" && tier.freeAddOn && code === input.freePerk) {
      lines.push({ label: `${addOn.name} (free this month)`, amountCents: 0 });
    } else {
      // Members get 10% off any additional add-ons.
      const price =
        input.plan === "membership"
          ? Math.round(addOn.priceCents * 0.9)
          : addOn.priceCents;
      lines.push({ label: addOn.name, amountCents: price });
    }
  }

  const totalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  return { lines, totalCents };
}
