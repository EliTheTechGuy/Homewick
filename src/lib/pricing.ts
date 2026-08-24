/**
 * Launch pricing catalog. Mirrors the seed rows in db/migrations/0001_initial_schema.sql.
 *
 * These values drive display and quoting. They are deliberately NOT the source
 * of truth for an existing member's rate. A subscription's rate is snapshotted
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
      "A reset for a place that has not been cleaned in a while. Baseboards, buildup, and detail work, plus inside the fridge and the cabinet interiors at no extra charge.",
  },
  {
    // The id stays move_out because it is a database enum and the work is the
    // same either way. Only the label changed, because half the people who
    // need an empty-unit clean are moving in rather than out and were reading
    // the old name as "not for me".
    id: "move_out",
    label: "Move In & Out",
    blurb:
      "An empty-unit clean, whether you are handing the keys back or picking them up. Aimed at the condition a leasing office inspects against, with every add-on included.",
  },
];

/** One-time service pricing, in cents. */
export const SERVICE_PRICES: Record<UnitSize, Record<ServiceType, number>> = {
  studio_1br: { standard: 11000, deep: 16000, move_out: 20900 },
  "2br_2ba": { standard: 15900, deep: 22000, move_out: 29900 },
  "3br_2ba": { standard: 21900, deep: 28000, move_out: 39900 },
};

/**
 * Discount on a new member's first month. Applied once, then the normal
 * monthly rate applies.
 *
 * This used to discount a separately-billed onboarding deep clean. Charging
 * the membership *and* a deep clean meant a member paid twice for their first
 * month of service, so the deep clean is now simply the first of that month's
 * two cleanings and the discount moved onto the membership itself.
 */
export const MEMBER_FIRST_MONTH_DISCOUNT = 0.15;

export type MembershipFrequency = "twice_monthly" | "monthly";

export type MembershipTier = {
  id: MembershipFrequency;
  /** Cleanings included in each billing period. */
  visitsPerPeriod: number;
  label: string;
  /** One line, used on the plan chooser in the booking form. */
  blurb: string;
  /** Fraction off the first month, or zero. */
  firstMonthDiscount: number;
  /** One eligible add-on free every period. */
  freeAddOn: boolean;
  /** The first cleaning after signup is quietly upgraded to a deep clean. */
  onboardingDeepClean: boolean;
  benefits: string[];
  prices: Record<
    UnitSize,
    { monthlyCents: number; perVisitCents: number; savesCents: number }
  >;
};

/**
 * Two ways to be a member, and the difference is not only how often we come.
 *
 * The twice-monthly tier is the discounted one. It is roughly 15% under two
 * one-time cleans, so it carries the extras: the discounted first month, the
 * free add-on, and a deep clean to start from.
 *
 * The once-monthly tier exists because customers asked for it, and it is
 * priced close to the one-time rate on purpose, a few dollars under. That gap
 * is too narrow to carry any of the extras. A free add-on is worth up to $45,
 * which on a $152 clean would make the cheaper tier the better deal per
 * dollar, and an onboarding deep clean on a month with only one visit costs
 * more than the month collects. Both are switched off here rather than in the
 * code that reads them, so the reason lives with the price.
 */
export const MEMBERSHIP_TIERS: Record<MembershipFrequency, MembershipTier> = {
  twice_monthly: {
    id: "twice_monthly",
    visitsPerPeriod: 2,
    label: "Twice a month",
    blurb: "Two cleanings a month, 15% off every visit, one free add-on each month.",
    firstMonthDiscount: MEMBER_FIRST_MONTH_DISCOUNT,
    freeAddOn: true,
    onboardingDeepClean: true,
    benefits: [
      "Two cleanings every billing period",
      "One free add-on every month from the eligible list",
      "The same cleaner whenever scheduling allows",
      "15% off your first month",
      "10% off any additional add-ons",
      "Priority scheduling",
    ],
    prices: {
      studio_1br: { monthlyCents: 18900, perVisitCents: 9500, savesCents: 3100 },
      "2br_2ba": { monthlyCents: 26900, perVisitCents: 13500, savesCents: 4900 },
      "3br_2ba": { monthlyCents: 36900, perVisitCents: 18500, savesCents: 6900 },
    },
  },
  monthly: {
    id: "monthly",
    visitsPerPeriod: 1,
    label: "Once a month",
    blurb: "One cleaning a month on the same day, booked and billed automatically.",
    firstMonthDiscount: 0,
    freeAddOn: false,
    onboardingDeepClean: false,
    benefits: [
      "One cleaning every billing period",
      "The same cleaner whenever scheduling allows",
      "10% off add-ons",
      "Priority scheduling",
      "Cancel with 14 days' notice",
    ],
    prices: {
      studio_1br: { monthlyCents: 10500, perVisitCents: 10500, savesCents: 500 },
      "2br_2ba": { monthlyCents: 15200, perVisitCents: 15200, savesCents: 700 },
      "3br_2ba": { monthlyCents: 20900, perVisitCents: 20900, savesCents: 1000 },
    },
  },
};

export const MEMBERSHIP_FREQUENCIES: MembershipFrequency[] = [
  "twice_monthly",
  "monthly",
];

export const DEFAULT_MEMBERSHIP_FREQUENCY: MembershipFrequency = "twice_monthly";

export const MOST_POPULAR_SIZE: UnitSize = "2br_2ba";

export function membershipTier(frequency: MembershipFrequency): MembershipTier {
  return MEMBERSHIP_TIERS[frequency];
}

export function membershipPrice(frequency: MembershipFrequency, size: UnitSize) {
  return MEMBERSHIP_TIERS[frequency].prices[size];
}

/**
 * Which tier a subscription is on, worked out from the visits it includes.
 *
 * Subscriptions store visits_per_period rather than a tier name, because that
 * number is what the visit generator and the payout split actually use. A
 * cadence agreed by hand in admin can be any number and matches no tier, hence
 * the null: the caller has to decide what to do about that rather than being
 * handed the wrong tier's rules.
 */
export function frequencyForVisits(
  visitsPerPeriod: number,
): MembershipFrequency | null {
  return (
    MEMBERSHIP_FREQUENCIES.find(
      (f) => MEMBERSHIP_TIERS[f].visitsPerPeriod === visitsPerPeriod,
    ) ?? null
  );
}

/**
 * What a new member's first cleaning is booked as.
 *
 * Operational only: a member buys "cleanings" and never sees this split. It is
 * a function rather than a ternary at the call site because it decides how much
 * work is done for the first payment, and a decision about money with nothing
 * asserting it is a decision that changes by accident.
 */
export function onboardingServiceType(frequency: MembershipFrequency): ServiceType {
  return MEMBERSHIP_TIERS[frequency].onboardingDeepClean ? "deep" : "standard";
}

/** What a new member pays today. Their second month onward is the full rate. */
export function firstMonthCents(
  size: UnitSize,
  frequency: MembershipFrequency = DEFAULT_MEMBERSHIP_FREQUENCY,
): number {
  const tier = MEMBERSHIP_TIERS[frequency];
  return Math.round(tier.prices[size].monthlyCents * (1 - tier.firstMonthDiscount));
}

/**
 * Charged once, on the booking that introduces the pet home, never per visit.
 *
 * The original brief made this recurring per visit, which for a member on two
 * cleanings a month is an extra $30 every month for the life of the
 * membership. That is a lot to attach to something the customer cannot change
 * about their home, so it was deliberately reduced to a single charge at
 * signup. Reinstating a recurring version means repricing membership for pet
 * homes, not flipping a flag here.
 */
export const PET_SURCHARGE_CENTS = 1500;

export type AddOn = {
  code: string;
  name: string;
  priceCents: number;
  /** Laundry is excluded on purpose: long, and the most dispute-prone service. */
  freePerkEligible: boolean;
};

/**
 * Repriced against what the metroplex actually charges. These are the prices
 * the site quotes.
 *
 * They must match the add_ons table row for row. The booking form quotes from
 * this list, and the code that writes the charge reads price_cents out of the
 * database, so a change made in one place and not the other shows a customer
 * one number and bills them another. A test asserts the two agree.
 */
export const ADD_ONS: AddOn[] = [
  { code: "oven", name: "Inside oven", priceCents: 2500, freePerkEligible: true },
  { code: "fridge", name: "Inside refrigerator", priceCents: 3000, freePerkEligible: true },
  { code: "windows", name: "Interior windows", priceCents: 3000, freePerkEligible: true },
  { code: "balcony", name: "Balcony / patio", priceCents: 2000, freePerkEligible: true },
  { code: "cabinets", name: "Cabinet interiors", priceCents: 2500, freePerkEligible: false },
  { code: "laundry", name: "Laundry, per load", priceCents: 1500, freePerkEligible: false },
];

export const FREE_PERK_ELIGIBLE = ADD_ONS.filter((a) => a.freePerkEligible);

/**
 * What each service already covers, rather than sells alongside itself.
 *
 * A fact about the service, not about the add-on. The same fridge clean is a
 * paid extra on a standard visit, part of a deep clean, and part of a move in
 * and out. Which it is depends entirely on what was booked.
 *
 * A standard clean includes none of them: it is the upkeep visit, and the
 * extras are genuinely extra.
 *
 * A deep clean is what you buy when a place needs resetting, and everywhere
 * else in this market that means the fridge and the cabinets are part of it.
 * Charging for them on top of the service somebody already chose because it is
 * the thorough one read as nickel-and-diming.
 *
 * A move in and out clean includes everything. It is the most expensive
 * service and it exists to hand a place over empty and inspection-ready, which
 * is not a thing you can do while leaving the oven out of it. Derived from the
 * catalog rather than listed, so a new add-on is covered the day it is added
 * and cannot be forgotten here.
 */
export const SERVICE_INCLUDES: Record<ServiceType, readonly string[]> = {
  standard: [],
  deep: ["fridge", "cabinets"],
  move_out: ADD_ONS.map((a) => a.code),
};

/** The add-on codes a service covers. Empty for a membership, which picks none. */
export function includedAddOnCodes(
  serviceType: ServiceType | undefined,
): readonly string[] {
  return serviceType ? SERVICE_INCLUDES[serviceType] : [];
}

/**
 * Whether this service already covers this add-on, so it must not be charged.
 *
 * A membership passes undefined and gets false for everything. Members buy
 * "cleanings" and never choose a service, so nothing is ever included on that
 * path even though their first visit is upgraded to a deep clean behind the
 * scenes.
 */
export function includedInService(
  code: string,
  serviceType: ServiceType | undefined,
): boolean {
  return includedAddOnCodes(serviceType).includes(code);
}

export function unitSizeLabel(size: UnitSize): string {
  return UNIT_SIZES.find((u) => u.id === size)?.label ?? size;
}

export function serviceTypeLabel(type: ServiceType): string {
  return SERVICE_TYPES.find((s) => s.id === type)?.label ?? type;
}

export function addOnByCode(code: string): AddOn | undefined {
  return ADD_ONS.find((a) => a.code === code);
}
