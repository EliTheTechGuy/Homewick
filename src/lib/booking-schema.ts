import { z } from "zod";
import {
  ADD_ONS,
  FREE_PERK_ELIGIBLE,
  PET_SURCHARGE_CENTS,
  SERVICE_PRICES,
  firstMonthCents,
} from "./pricing";
import { isISODate } from "./dates";

const unitSize = z.enum(["studio_1br", "2br_2ba", "3br_2ba"]);
const serviceType = z.enum(["standard", "deep", "move_out"]);
const addOnCodes = ADD_ONS.map((a) => a.code) as [string, ...string[]];
const freePerkCodes = FREE_PERK_ELIGIBLE.map((a) => a.code) as [string, ...string[]];

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
        message: "Choose a preferred weekday",
      });
    }
    // The free perk is a membership entitlement and must be an eligible add-on.
    if (data.plan === "one_time" && data.freePerk) {
      ctx.addIssue({
        code: "custom",
        path: ["freePerk"],
        message: "The free add-on is a membership benefit",
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
 * Membership signups are billed as the monthly rate plus the discounted
 * onboarding deep clean, which is charged separately rather than folded into
 * the first month, the monthly price stays what the site says it is.
 */
export type QuoteParams = {
  plan: "one_time" | "membership";
  unitSize: "studio_1br" | "2br_2ba" | "3br_2ba";
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

  if (input.plan === "membership") {
    // A member pays the membership price and nothing else. The onboarding deep
    // clean is one of the first month's two cleanings, not a second charge on
    // top, billing both charged twice for the same month of service.
    lines.push({
      label: "Membership, first month (15% off)",
      amountCents: firstMonthCents(input.unitSize),
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

  for (const code of input.addOns) {
    const addOn = ADD_ONS.find((a) => a.code === code);
    if (!addOn) continue;
    if (input.plan === "membership" && code === input.freePerk) {
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
