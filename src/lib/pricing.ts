/**
 * Launch pricing catalog. Mirrors the seed rows in db/schema.sql.
 *
 * These values drive display and quoting. They are deliberately NOT the source
 * of truth for an existing member's rate — a subscription's rate is snapshotted
 * onto the subscription row at signup so that raising list price never
 * reprices anyone already signed up.
 *
 * All money is integer cents.
 */

export type UnitSize = "studio_1br" | "2br_2ba" | "3br_2ba";
export type ServiceType = "standard" | "deep" | "move_out";

export const UNIT_SIZES: { id: UnitSize; label: string }[] = [
  { id: "studio_1br", label: "Studio & 1 Bedroom" },
  { id: "2br_2ba", label: "2 Bed / 2 Bath" },
  { id: "3br_2ba", label: "3 Bed / 2 Bath" },
];

export const SERVICE_TYPES: { id: ServiceType; label: string; blurb: string }[] = [
  {
    id: "standard",
    label: "Standard",
    blurb:
      "The regular upkeep clean: kitchen, bathrooms, floors, surfaces, and trash throughout.",
  },
  {
    id: "deep",
    label: "Deep Clean",
    blurb:
      "A reset for a place that has not been cleaned in a while. Baseboards, buildup, and detail work included.",
  },
  {
    id: "move_out",
    label: "Move-Out",
    blurb:
      "An empty-unit clean aimed at the condition a leasing office inspects against.",
  },
];

/** One-time service pricing, in cents. */
export const SERVICE_PRICES: Record<UnitSize, Record<ServiceType, number>> = {
  studio_1br: { standard: 11000, deep: 16900, move_out: 20900 },
  "2br_2ba": { standard: 15900, deep: 23900, move_out: 29900 },
  "3br_2ba": { standard: 21900, deep: 32900, move_out: 39900 },
};

/** Membership: two cleanings per billing period, 15% off each visit. */
export const MEMBERSHIP_PRICES: Record<
  UnitSize,
  { monthlyCents: number; perVisitCents: number; savesCents: number }
> = {
  studio_1br: { monthlyCents: 18900, perVisitCents: 9500, savesCents: 3100 },
  "2br_2ba": { monthlyCents: 26900, perVisitCents: 13500, savesCents: 4900 },
  "3br_2ba": { monthlyCents: 36900, perVisitCents: 18500, savesCents: 6900 },
};

export const MOST_POPULAR_SIZE: UnitSize = "2br_2ba";

export const VISITS_PER_PERIOD = 2;

/** Applied per visit whenever the property has pets. Recurring, not an add-on. */
export const PET_SURCHARGE_CENTS = 1500;

/** Discount applied to a new member's onboarding deep clean. */
export const MEMBER_DEEP_CLEAN_DISCOUNT = 0.15;

export type AddOn = {
  code: string;
  name: string;
  priceCents: number;
  /** Laundry is excluded on purpose: long, and the most dispute-prone service. */
  freePerkEligible: boolean;
};

export const ADD_ONS: AddOn[] = [
  { code: "oven", name: "Inside oven", priceCents: 3500, freePerkEligible: true },
  { code: "fridge", name: "Inside refrigerator", priceCents: 3500, freePerkEligible: true },
  { code: "windows", name: "Interior windows", priceCents: 4500, freePerkEligible: true },
  { code: "balcony", name: "Balcony / patio", priceCents: 2500, freePerkEligible: true },
  { code: "cabinets", name: "Cabinet interiors", priceCents: 4500, freePerkEligible: false },
  { code: "laundry", name: "Laundry, per load", priceCents: 2500, freePerkEligible: false },
];

export const FREE_PERK_ELIGIBLE = ADD_ONS.filter((a) => a.freePerkEligible);

export const MEMBER_BENEFITS = [
  "One free add-on every month from the eligible list",
  "The same cleaner whenever scheduling allows",
  "15% off your onboarding deep clean",
  "10% off any additional add-ons",
  "Priority scheduling",
];

export function unitSizeLabel(size: UnitSize): string {
  return UNIT_SIZES.find((u) => u.id === size)?.label ?? size;
}

export function serviceTypeLabel(type: ServiceType): string {
  return SERVICE_TYPES.find((s) => s.id === type)?.label ?? type;
}

export function addOnByCode(code: string): AddOn | undefined {
  return ADD_ONS.find((a) => a.code === code);
}
