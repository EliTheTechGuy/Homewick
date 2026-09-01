import assert from "node:assert/strict";
import { test } from "vitest";
import { addDays, addMonths, daysBetween, firstWeekdayOnOrAfter, today } from "./dates";
import { visitReminderEmail } from "./emails/templates";
import { quoteFor } from "./booking-schema";
import { hashPassword, verifyPassword, passwordProblem } from "./passwords";
import {
  MEMBERSHIP_TIERS,
  MEMBER_FIRST_MONTH_DISCOUNT,
  PET_SURCHARGE_CENTS,
  ADD_ONS,
  SERVICE_INCLUDES,
  SERVICE_PRICES,
  addOnByCode,
  frequencyForVisits,
  onboardingServiceType,
} from "./pricing";
import {
  cancellationEndDate,
  nextPeriod,
  periodContaining,
  periodsToGenerate,
  rateForPeriod,
  visitDatesForPeriod,
  type SubscriptionRow,
} from "./membership-lifecycle";

function sub(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "sub_1",
    customer_id: "cus_1",
    property_id: "prop_1",
    status: "active",
    monthly_amount_cents: 26900,
    visits_per_period: 2,
    pet_surcharge_cents: 0,
    interval_days: null,
    payment_terms: "on_booking",
    visit_time: "09:00",
    preferred_weekday: 4, // Thursday
    preferred_weekday_second: null,
    started_on: "2026-01-15",
    billing_day: 15,
    pending_amount_cents: null,
    pending_amount_effective_on: null,
    ends_on: null,
    ...overrides,
  };
}

test("date math does not drift across month ends or leap years", () => {
  assert.equal(addMonths("2026-01-28", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-28", 1), "2028-02-28"); // leap year
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

test("periods are anchored to the signup date, not the calendar month", () => {
  const s = sub({ started_on: "2026-01-15", billing_day: 15 });

  assert.deepEqual(periodContaining(s, "2026-01-15"), {
    start: "2026-01-15",
    end: "2026-02-15",
  });
  // The day before the anchor still belongs to the previous period.
  assert.deepEqual(periodContaining(s, "2026-02-14"), {
    start: "2026-01-15",
    end: "2026-02-15",
  });
  assert.deepEqual(periodContaining(s, "2026-02-15"), {
    start: "2026-02-15",
    end: "2026-03-15",
  });
});

test("February does not shorten the entitlement", () => {
  const s = sub({ started_on: "2026-01-28", billing_day: 28 });
  assert.deepEqual(periodContaining(s, "2026-02-01"), {
    start: "2026-01-28",
    end: "2026-02-28",
  });
  assert.deepEqual(periodContaining(s, "2026-02-28"), {
    start: "2026-02-28",
    end: "2026-03-28",
  });
});

test("billing_day outside 1-28 is rejected rather than silently mishandled", () => {
  assert.throws(() => periodContaining(sub({ billing_day: 31 }), "2026-03-01"), /1 and 28/);
});

test("both visits land inside their own period, never across the boundary", () => {
  const period = { start: "2026-01-15", end: "2026-02-15" };
  const dates = visitDatesForPeriod(period, [4], 2);

  assert.equal(dates.length, 2);
  for (const d of dates) {
    assert.ok(d >= period.start && d < period.end, `${d} escaped its period`);
  }
  assert.equal(dates[0], firstWeekdayOnOrAfter("2026-01-15", 4));
  assert.equal(dates[1], addDays(dates[0], 14));
});

test("second visit is pulled back rather than spilling into the next period", () => {
  // A preferred weekday landing late in the period leaves no room for +14.
  const period = { start: "2026-01-15", end: "2026-02-15" };
  const late = visitDatesForPeriod({ ...period, end: "2026-02-01" }, [4], 2);
  for (const d of late) {
    assert.ok(d < "2026-02-01", `${d} escaped a short period`);
  }
});

test("no visit is scheduled before the notBefore date", () => {
  // A member signing up on the 13th must not be sent a cleaner on the 13th.
  const period = { start: "2026-08-13", end: "2026-09-13" };
  const dates = visitDatesForPeriod(period, [4], 2, "2026-08-21");

  assert.ok(dates.length > 0);
  for (const d of dates) {
    assert.ok(d >= "2026-08-21", `${d} was scheduled before the earliest allowed date`);
    assert.ok(d < period.end, `${d} escaped its period`);
  }
});

test("regular cleanings fall after the onboarding deep clean", () => {
  // Signup 2026-08-13 (a Thursday), preferred weekday Thursday.
  const deepClean = "2026-08-20"; // first Thursday at least MIN_LEAD_DAYS out
  const period = { start: "2026-08-13", end: "2026-09-13" };
  const dates = visitDatesForPeriod(period, [4], 2, addDays(deepClean, 1));

  for (const d of dates) {
    assert.ok(d > deepClean, `standard clean ${d} lands before the deep clean`);
  }
});

test("notBefore does not push a visit past the period end", () => {
  const period = { start: "2026-08-13", end: "2026-09-13" };
  const dates = visitDatesForPeriod(period, [4], 2, "2026-09-10");
  for (const d of dates) {
    assert.ok(d < period.end, `${d} escaped its period`);
  }
});

test("no preferred weekday falls back to the period start", () => {
  const dates = visitDatesForPeriod({ start: "2026-01-15", end: "2026-02-15" }, [null], 2);
  assert.equal(dates[0], "2026-01-15");
});

test("generation looks ahead but stops at three periods", () => {
  const periods = periodsToGenerate(sub(), "2026-01-15");
  assert.ok(periods.length >= 2, "should look past the current period");
  assert.ok(periods.length <= 3, "should not run away into the future");
  assert.equal(periods[0].start, "2026-01-15");
});

test("a cancelled subscription stops generating at its end date", () => {
  const s = sub({ status: "pending_cancellation", ends_on: "2026-02-15" });
  const periods = periodsToGenerate(s, "2026-01-15");

  assert.equal(periods.length, 1);
  assert.equal(periods[0].start, "2026-01-15");

  assert.deepEqual(periodsToGenerate(sub({ status: "canceled" }), "2026-01-15"), []);
});

test("14+ days of notice ends service at the current period end", () => {
  const s = sub({ started_on: "2026-01-15", billing_day: 15 });
  // Period runs 01-15 → 02-15; notice on 01-20 leaves 26 days.
  assert.equal(cancellationEndDate(s, "2026-01-20"), "2026-02-15");
});

test("short notice runs service through the following period", () => {
  const s = sub({ started_on: "2026-01-15", billing_day: 15 });
  // Notice on 02-10 leaves 5 days in the period, under the 14-day notice.
  assert.equal(cancellationEndDate(s, "2026-02-10"), "2026-03-15");
});

test("exactly 14 days of notice ends at the current period end", () => {
  const s = sub({ started_on: "2026-01-15", billing_day: 15 });
  assert.equal(cancellationEndDate(s, "2026-02-01"), "2026-02-15");
});

test("a scheduled rate change only applies from its effective date", () => {
  const s = sub({
    monthly_amount_cents: 26900,
    pending_amount_cents: 27900,
    pending_amount_effective_on: "2026-03-15",
  });

  assert.equal(rateForPeriod(s, { start: "2026-02-15", end: "2026-03-15" }), 26900);
  assert.equal(rateForPeriod(s, { start: "2026-03-15", end: "2026-04-15" }), 27900);
});

test("existing members are grandfathered when no change is scheduled", () => {
  assert.equal(
    rateForPeriod(sub(), { start: "2027-06-15", end: "2027-07-15" }),
    26900,
  );
});

test("today() returns a YYYY-MM-DD string", () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

// --- Quote parity -----------------------------------------------------
// The booking page shows a "Due today" figure and Stripe then charges one.
// These drifted apart once already: a pet home was quoted $487.15 and
// charged $472.15, because checkout summed only the deep clean's base rate.

test("a membership quote bills every component it displays", async () => {
  const { quoteFor } = await import("./booking-schema");

  const quote = quoteFor({
    plan: "membership",
    unitSize: "2br_2ba",
    addOns: ["oven"],
    freePerk: "oven",
    hasPets: true,
  });

  // What checkout builds its line items from: the monthly rate with the
  // first-month discount applied, the one-time pet surcharge, and paid add-ons.
  // There is deliberately no separate deep-clean charge, the deep clean is one
  // of the two cleanings the first month already pays for.
  const firstMonth = Math.round(26900 * 0.85); // 22865
  const petSurcharge = 1500;
  const paidAddOns = 0; // the only add-on chosen is the free perk

  assert.equal(
    quote.totalCents,
    firstMonth + petSurcharge + paidAddOns,
    "the displayed total and the Stripe line items have drifted apart",
  );
  assert.equal(quote.totalCents, 24365);
});

test("a paid add-on is included in the quoted total", async () => {
  const { quoteFor } = await import("./booking-schema");

  const quote = quoteFor({
    plan: "membership",
    unitSize: "2br_2ba",
    addOns: ["oven", "laundry"],
    freePerk: "oven",
    hasPets: false,
  });

  // Laundry is not perk-eligible, so a member pays it at the 10% member rate.
  // Read from the catalog rather than written out, because an add-on reprice
  // should not need this arithmetic edited in two places to stay true.
  const laundry = addOnByCode("laundry")!.priceCents;
  assert.equal(quote.totalCents, Math.round(26900 * 0.85) + Math.round(laundry * 0.9));
});

test("the pet surcharge is charged once, not on every visit", async () => {
  const { quoteFor } = await import("./booking-schema");

  const withPets = quoteFor({
    plan: "membership",
    unitSize: "2br_2ba",
    addOns: [],
    hasPets: true,
  });
  const withoutPets = quoteFor({
    plan: "membership",
    unitSize: "2br_2ba",
    addOns: [],
    hasPets: false,
  });

  // Exactly one surcharge on the whole signup, not one per cleaning, and not
  // folded into the recurring monthly rate.
  assert.equal(withPets.totalCents - withoutPets.totalCents, 1500);
  assert.equal(
    withPets.lines.filter((l) => l.label === "Pet home surcharge").length,
    1,
  );
});

test("a front-desk booking needs no entry code", async () => {
  const { bookingSchema } = await import("./booking-schema");

  const base = {
    firstName: "Lobby", lastName: "Entry",
    email: "lobby@example.com", phone: "2145550111",
    line1: "900 Ross Ave", line2: "", city: "Dallas", state: "TX",
    postalCode: "75202",
    unitSize: "2br_2ba", plan: "one_time", serviceType: "standard",
    addOns: [], freePerk: "", hasPets: false,
    alarmInstructions: "", instructions: "", preferredDate: "",
    smsConsent: false, acceptTerms: true,
  };

  // No code, because someone is letting the cleaner in.
  const frontDesk = bookingSchema.safeParse({
    ...base, entryMethod: "front_desk", entryDetail: "",
  });
  assert.equal(frontDesk.success, true);

  // Choosing a code method and leaving it blank is still rejected.
  const blankCode = bookingSchema.safeParse({
    ...base, entryMethod: "door_code", entryDetail: "",
  });
  assert.equal(blankCode.success, false);
  assert.match(
    blankCode.error!.issues.map((i) => i.message).join(" "),
    /Add the code/,
  );
});

test("a member is not charged twice for their first month", async () => {
  const { quoteFor } = await import("./booking-schema");
  const { MEMBERSHIP_TIERS, SERVICE_PRICES } = await import("./pricing");
  const monthlyCents = (size: "studio_1br" | "2br_2ba" | "3br_2ba") =>
    MEMBERSHIP_TIERS.twice_monthly.prices[size].monthlyCents;

  for (const size of ["studio_1br", "2br_2ba", "3br_2ba"] as const) {
    const quote = quoteFor({ plan: "membership", unitSize: size, addOns: [], hasPets: false });

    // One line, one charge: the discounted first month. A separately billed
    // onboarding deep clean on top meant paying twice for the same month.
    assert.equal(quote.lines.length, 1, `${size} should quote a single charge`);
    assert.equal(quote.totalCents, Math.round(monthlyCents(size) * 0.85));

    // Never more than the ordinary monthly rate.
    assert.ok(
      quote.totalCents < monthlyCents(size),
      `${size} first month should be below the standard rate`,
    );
    // And nowhere near the old membership-plus-deep-clean figure.
    const oldTotal = monthlyCents(size) + Math.round(SERVICE_PRICES[size].deep * 0.85);
    assert.ok(quote.totalCents < oldTotal);
  }
});

// --- Reminder timing --------------------------------------------------
// Vercel schedules in UTC and ignores daylight saving, so the job runs twice
// and a window decides which run is actually 9am in Texas.

test("reminders only send during the morning window", async () => {
  const { sendScheduledEmails } = await import("./emails/scheduled");

  // 8am, which is what 14:00 UTC becomes in winter. Must not send.
  const early = await sendScheduledEmails("2026-12-15", 8);
  assert.equal(early.remindersSent, 0);
  assert.equal(early.nudgesSent, 0);
  assert.match(early.skipped ?? "", /outside/);

  // 10pm, in case a run fires very late. Must not send.
  const late = await sendScheduledEmails("2026-12-15", 22);
  assert.match(late.skipped ?? "", /outside/);
});

test("the two scheduled runs land on 9am in Texas all year", () => {
  const hourIn = (iso: string) =>
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Chicago",
        hour: "2-digit",
        hour12: false,
      }).format(new Date(iso)),
    );

  // Summer: the 14:00 run is 9am and sends, the 15:00 run is 10am and finds
  // nothing new because sends are deduplicated per visit.
  assert.equal(hourIn("2026-08-15T14:00:00Z"), 9);
  assert.equal(hourIn("2026-08-15T15:00:00Z"), 10);

  // Winter: the 14:00 run is 8am and skips, the 15:00 run is 9am and sends.
  assert.equal(hourIn("2026-12-15T14:00:00Z"), 8);
  assert.equal(hourIn("2026-12-15T15:00:00Z"), 9);
});

// --- Independent weekday per cleaning ---------------------------------

test("each cleaning can sit on its own weekday", () => {
  const period = { start: "2026-08-13", end: "2026-09-13" };

  // First on Tuesday (2), second on Wednesday (3).
  const dates = visitDatesForPeriod(period, [2, 3], 2, "2026-08-13");
  assert.equal(dates.length, 2);

  const dayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  assert.equal(dayOf(dates[0]), 2, "first should be a Tuesday");
  assert.equal(dayOf(dates[1]), 3, "second should be a Wednesday");

  // Spread across the month rather than landing next to each other.
  assert.ok(daysBetween(dates[0], dates[1]) >= 10);
  for (const d of dates) assert.ok(d >= period.start && d < period.end);
});

test("a shared weekday still gives a clean fortnight", () => {
  const dates = visitDatesForPeriod(
    { start: "2026-08-13", end: "2026-09-13" },
    [4, 4],
    2,
    "2026-08-13",
  );
  assert.equal(daysBetween(dates[0], dates[1]), 14);
});

test("a second weekday of null follows the first", () => {
  const withNull = visitDatesForPeriod(
    { start: "2026-08-13", end: "2026-09-13" },
    [4, null],
    2,
    "2026-08-13",
  );
  const bothSame = visitDatesForPeriod(
    { start: "2026-08-13", end: "2026-09-13" },
    [4, 4],
    2,
    "2026-08-13",
  );
  assert.deepEqual(withNull, bothSame, "existing members must not shift");
});

test("differing weekdays never push a cleaning into the next period", () => {
  // Every weekday pair, across a period that starts on each weekday.
  for (let start = 13; start <= 19; start++) {
    const period = { start: `2026-08-${start}`, end: `2026-09-${start}` };
    for (let a = 0; a < 7; a++) {
      for (let b = 0; b < 7; b++) {
        for (const d of visitDatesForPeriod(period, [a, b], 2, period.start)) {
          assert.ok(
            d >= period.start && d < period.end,
            `weekdays ${a}/${b} in ${period.start} produced ${d}`,
          );
        }
      }
    }
  }
});

test("a moved cleaning earns a reminder for its new day", () => {
  // The dedupe key is what decides whether a reminder is sent again. Keying on
  // the visit alone meant that moving a cleaning after its reminder had gone
  // sent nothing for the day somebody actually turned up.
  const visitId = "5f0f4b1e-0000-4000-8000-000000000001";
  const key = (onDate: string) => `visit:${visitId}:${onDate}`;

  assert.notEqual(
    key("2026-08-20"),
    key("2026-08-25"),
    "a rescheduled cleaning must not reuse the old reminder claim",
  );
  assert.equal(
    key("2026-08-20"),
    key("2026-08-20"),
    "a repeated run on the same day must still dedupe",
  );
});

test("the reminder says today when it goes out on the morning itself", () => {
  const shared = {
    firstName: "Sam",
    address: "1200 Main St, Dallas, TX 75201",
    freeAddOnName: null,
  };

  const tomorrow = visitReminderEmail({ ...shared, onDate: "2026-08-20" });
  assert.match(tomorrow.subject, /tomorrow/);
  assert.match(tomorrow.text, /Tomorrow/);

  // Reached when the previous day's run failed and the backfill catches it.
  const sameDay = visitReminderEmail({ ...shared, onDate: "2026-08-20", when: "today" });
  assert.match(sameDay.subject, /today/);
  assert.doesNotMatch(
    sameDay.subject,
    /tomorrow/,
    "a same-morning reminder must not tell somebody the wrong day",
  );
});

test("the welcome discount comes off the membership and nothing else", () => {
  // The bug this guards: the coupon was applied to the whole Stripe session,
  // and in subscription mode the pet surcharge and add-ons land on that same
  // first invoice, so 15% came off those too. A 2 bed signup with pets and
  // one add-on was quoted $275.15 and charged $268.17.
  //
  // Asserted as a property of the quote rather than by re-deriving it: only
  // the membership line may differ from its undiscounted price.
  const withExtras = quoteFor({
    plan: "membership",
    unitSize: "2br_2ba",
    serviceType: undefined,
    hasPets: true,
    addOns: ["oven"],
    freePerk: undefined,
  } as never);

  const membershipLine = withExtras.lines.find((l) => /Membership/.test(l.label));
  assert.ok(membershipLine, "a membership booking must quote a membership line");
  assert.equal(
    membershipLine.amountCents,
    Math.round(
      MEMBERSHIP_TIERS.twice_monthly.prices["2br_2ba"].monthlyCents *
        (1 - MEMBER_FIRST_MONTH_DISCOUNT),
    ),
    "the membership line carries the whole first-month discount",
  );

  const pets = withExtras.lines.find((l) => /Pet/.test(l.label));
  assert.equal(
    pets?.amountCents,
    PET_SURCHARGE_CENTS,
    "the pet surcharge is a flat charge and must not be discounted",
  );

  // The total is the sum of its lines, so nothing may be discounted twice by
  // a coupon applied on top at the Stripe end.
  const summed = withExtras.lines.reduce((n, l) => n + l.amountCents, 0);
  assert.equal(summed, withExtras.totalCents, "the total must be exactly its lines");
});

test("every membership size quotes a first month of exactly 15 percent off", () => {
  for (const size of ["studio_1br", "2br_2ba", "3br_2ba"] as const) {
    const quote = quoteFor({
      plan: "membership",
      unitSize: size,
      serviceType: undefined,
      hasPets: false,
      addOns: [],
      freePerk: undefined,
    } as never);

    const monthly = MEMBERSHIP_TIERS.twice_monthly.prices[size].monthlyCents;
    assert.equal(
      quote.totalCents,
      Math.round(monthly * (1 - MEMBER_FIRST_MONTH_DISCOUNT)),
      `${size} first month must be 15% off ${monthly}`,
    );
    // Integer cents throughout; a fractional charge would be a rounding bug.
    assert.equal(Math.round(quote.totalCents), quote.totalCents);
  }
});

test("a password verifies against its own hash and nothing else", async () => {
  const password = "four random words together";
  const stored = await hashPassword(password);

  assert.match(stored, /^scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/, "shape");
  assert.ok(!stored.includes(password), "the password itself must not survive in the hash");

  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword("four random words togethe", stored), false);
  assert.equal(await verifyPassword("", stored), false);

  // Same password, different salt, so two accounts sharing one password do
  // not share a hash and cannot be spotted as identical in a leaked dump.
  const again = await hashPassword(password);
  assert.notEqual(stored, again, "each hash must carry its own salt");
  assert.equal(await verifyPassword(password, again), true);
});

test("a broken or missing hash refuses rather than throwing", async () => {
  // These reach verifyPassword from the sign-in path when no account matched,
  // so throwing would turn a wrong address into a 500 and tell somebody the
  // address was wrong. Refusing quietly is the whole point.
  for (const bad of [null, "", "not-a-hash", "scrypt$abc$8$1$aa$bb", "scrypt$32768$8$1$zz"]) {
    assert.equal(await verifyPassword("anything", bad), false, `should refuse: ${bad}`);
  }
});

test("passwords too short or too obvious are rejected", () => {
  assert.ok(passwordProblem("short"), "under the minimum");
  assert.ok(passwordProblem("aaaaaaaaaaaaaaaa"), "one repeated character");
  assert.ok(passwordProblem("homewick-cleaning-2026"), "contains the business name");
  assert.equal(passwordProblem("scatter marble tundra ledger"), null, "four words is fine");
});

/**
 * A cadence that is not a month. Every three weeks was the case that prompted
 * it, arriving from a lead platform rather than the booking form.
 *
 * The monthly path is deliberately untouched, so the last test here checks
 * that a null interval still behaves exactly as it always did.
 */
function every3Weeks(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return sub({
    started_on: "2026-03-02",
    interval_days: 21,
    visits_per_period: 1,
    ...overrides,
  });
}

test("custom interval: periods are exactly the interval long, from the start date", () => {
  const p = periodContaining(every3Weeks(), "2026-03-02");
  assert.equal(p.start, "2026-03-02");
  assert.equal(p.end, "2026-03-23");
});

test("custom interval: walks forward in whole intervals, not months", () => {
  // 2026-04-01 falls in the third period: Mar 2, Mar 23, Apr 13.
  const p = periodContaining(every3Weeks(), "2026-04-01");
  assert.equal(p.start, "2026-03-23");
  assert.equal(p.end, "2026-04-13");
});

test("custom interval: ignores billing_day, which means nothing on this cadence", () => {
  const a = periodContaining(every3Weeks({ billing_day: 1 }), "2026-04-01");
  const b = periodContaining(every3Weeks({ billing_day: 28 }), "2026-04-01");
  assert.deepEqual(a, b);
});

test("custom interval: periods chain with no gap and no overlap", () => {
  const s = every3Weeks();
  const first = periodContaining(s, "2026-03-02");
  const second = nextPeriod(s, first);
  assert.equal(second.start, first.end);
  assert.equal(second.end, "2026-04-13");
});

test("custom interval: a generated run stays 21 days apart throughout", () => {
  const periods = periodsToGenerate(every3Weeks(), "2026-03-02");
  assert.ok(periods.length > 1, "expected more than one period");
  for (let i = 1; i < periods.length; i++) {
    assert.equal(periods[i].start, periods[i - 1].end);
    assert.equal(daysBetween(periods[i].start, periods[i].end), 21);
  }
});

test("custom interval: stops generating once a cancelled sub passes its end date", () => {
  const periods = periodsToGenerate(
    every3Weeks({ status: "pending_cancellation", ends_on: "2026-03-23" }),
    "2026-03-02",
  );
  assert.ok(periods.every((p) => p.start < "2026-03-23"));
});

test("custom interval: refuses one short enough to stack visits on each other", () => {
  assert.throws(() => periodContaining(every3Weeks({ interval_days: 3 }), "2026-03-02"));
});

test("custom interval: a null interval leaves the monthly path exactly as it was", () => {
  const monthly = sub({ started_on: "2026-01-15", billing_day: 15, interval_days: null });
  const p = periodContaining(monthly, "2026-02-01");
  assert.equal(p.start, "2026-01-15");
  assert.equal(p.end, "2026-02-15");
  assert.equal(nextPeriod(monthly, p).end, "2026-03-15");
});

// --- The once-a-month tier --------------------------------------------
//
// It is priced within a few dollars of a one-time clean, so every benefit it
// picks up by accident from the discounted tier costs more than the tier
// makes. These are the ways that could happen quietly.

test("the once-a-month tier quotes its full published rate", () => {
  for (const size of ["studio_1br", "2br_2ba", "3br_2ba"] as const) {
    const quote = quoteFor({
      plan: "membership",
      unitSize: size,
      frequency: "monthly",
      addOns: [],
      hasPets: false,
    });

    assert.equal(quote.lines.length, 1, `${size} should quote a single charge`);
    assert.equal(
      quote.totalCents,
      MEMBERSHIP_TIERS.monthly.prices[size].monthlyCents,
      `${size} once a month must be charged in full, not discounted`,
    );
    assert.doesNotMatch(
      quote.lines[0].label,
      /% off/,
      "a line that says 15% off next to a number that is not 15% off is a complaint waiting to happen",
    );
  }
});

test("no tier is ever priced above what the same cleaning costs one at a time", () => {
  for (const frequency of ["twice_monthly", "monthly"] as const) {
    const tier = MEMBERSHIP_TIERS[frequency];
    for (const size of ["studio_1br", "2br_2ba", "3br_2ba"] as const) {
      const oneAtATime = SERVICE_PRICES[size].standard * tier.visitsPerPeriod;
      const price = tier.prices[size];

      // Never more than buying the same cleanings singly. Equal is allowed
      // and is what the once-a-month studio does deliberately: that tier sells
      // the booking and billing happening on their own, not a discount. More
      // expensive is always wrong, because nobody would take it.
      assert.ok(
        price.monthlyCents <= oneAtATime,
        `${frequency} ${size} costs more than buying the same cleanings singly`,
      );
      // The advertised saving is the whole of the difference. Stated rather
      // than derived in the catalog, so it can drift from the one-time prices
      // it is measured against, and a saving the arithmetic does not support
      // is the kind of thing a customer checks.
      assert.equal(
        price.savesCents,
        oneAtATime - price.monthlyCents,
        `${frequency} ${size} advertises a saving its own prices do not support`,
      );
    }
  }
});

test("a free add-on cannot be claimed on a tier that does not include one", async () => {
  const { bookingSchema } = await import("./booking-schema");

  const base = {
    firstName: "Once", lastName: "Monthly",
    email: "once@example.com", phone: "2145550188",
    line1: "900 Ross Ave", line2: "", city: "Dallas", state: "TX",
    postalCode: "75202",
    unitSize: "2br_2ba", plan: "membership", preferredWeekday: 4,
    addOns: ["oven"], freePerk: "oven", hasPets: false,
    entryMethod: "front_desk", entryDetail: "",
    alarmInstructions: "", instructions: "", preferredDate: "",
    smsConsent: false, acceptTerms: true,
  };

  const twice = bookingSchema.safeParse({ ...base, frequency: "twice_monthly" });
  assert.equal(twice.success, true, "the twice-a-month tier does include one");

  const once = bookingSchema.safeParse({ ...base, frequency: "monthly" });
  assert.equal(once.success, false, "the once-a-month tier does not");

  // And the quote refuses it too, so a caller that skipped the schema still
  // cannot hand out a $35 job for nothing.
  const quote = quoteFor({
    plan: "membership",
    unitSize: "2br_2ba",
    frequency: "monthly",
    addOns: ["oven"],
    freePerk: "oven",
    hasPets: false,
  });
  assert.ok(
    quote.lines.every((l) => !/free/i.test(l.label)),
    "nothing on the once-a-month tier is free",
  );
  assert.equal(
    quote.totalCents,
    MEMBERSHIP_TIERS.monthly.prices["2br_2ba"].monthlyCents +
      Math.round(addOnByCode("oven")!.priceCents * 0.9),
    "the add-on is charged at the member rate, not given away",
  );
});

test("a subscription's tier is recognised from the visits it includes", () => {
  assert.equal(frequencyForVisits(2), "twice_monthly");
  assert.equal(frequencyForVisits(1), "monthly");
  // A cadence agreed by hand belongs to no tier, and must not be mapped onto
  // the nearest one: that is how a $145 house arrangement would inherit the
  // first-month discount and the free add-on.
  assert.equal(frequencyForVisits(3), null);
  assert.equal(frequencyForVisits(0), null);
});

test("only the tier that pays for a deep clean gets one at signup", () => {
  // Two cleanings a month can carry a deep one as the first of the two. One
  // cleaning a month cannot: the deep clean for a 2 bed lists at $220 and the
  // period collects $152, with nothing else that month to make it back.
  assert.equal(onboardingServiceType("twice_monthly"), "deep");
  assert.equal(onboardingServiceType("monthly"), "standard");

  for (const frequency of ["twice_monthly", "monthly"] as const) {
    const tier = MEMBERSHIP_TIERS[frequency];
    if (onboardingServiceType(frequency) !== "deep") continue;
    for (const size of ["studio_1br", "2br_2ba", "3br_2ba"] as const) {
      assert.ok(
        tier.prices[size].monthlyCents > SERVICE_PRICES[size].deep,
        `${frequency} ${size} would give away a deep clean worth more than the period collects`,
      );
    }
  }
});

// --- What a deep clean covers ------------------------------------------

test("a deep clean covers the fridge and the cabinets without charging for them", () => {
  const deep = quoteFor({
    plan: "one_time",
    unitSize: "2br_2ba",
    serviceType: "deep",
    addOns: [],
    hasPets: false,
  });

  // Quoted whether or not they were asked for, so the itemised lines and the
  // total describe the same visit.
  for (const code of SERVICE_INCLUDES.deep) {
    const line = deep.lines.find((l) => l.label.startsWith(addOnByCode(code)!.name));
    assert.ok(line, `${code} should appear on a deep clean quote`);
    assert.equal(line.amountCents, 0, `${code} must not be charged on a deep clean`);
  }
  assert.equal(
    deep.totalCents,
    SERVICE_PRICES["2br_2ba"].deep,
    "a deep clean with nothing else added costs exactly the deep clean price",
  );

  // Ticking them explicitly changes nothing. Somebody who selected the fridge
  // and then switched to a deep clean must not be billed for it, and must not
  // see it listed twice.
  const ticked = quoteFor({
    plan: "one_time",
    unitSize: "2br_2ba",
    serviceType: "deep",
    addOns: [...SERVICE_INCLUDES.deep],
    hasPets: false,
  });
  assert.equal(ticked.totalCents, deep.totalCents);
  assert.equal(ticked.lines.length, deep.lines.length);

  // And the two it does not cover are still sold on a deep clean.
  const withOven = quoteFor({
    plan: "one_time",
    unitSize: "2br_2ba",
    serviceType: "deep",
    addOns: ["oven"],
    hasPets: false,
  });
  assert.equal(withOven.totalCents, deep.totalCents + addOnByCode("oven")!.priceCents);
});

test("a move in and out clean covers every add-on there is", () => {
  const quote = quoteFor({
    plan: "one_time",
    unitSize: "2br_2ba",
    serviceType: "move_out",
    addOns: ADD_ONS.map((a) => a.code),
    hasPets: false,
  });

  assert.equal(
    quote.totalCents,
    SERVICE_PRICES["2br_2ba"].move_out,
    "asking for every add-on on a move out must not add a cent",
  );
  for (const a of ADD_ONS) {
    const line = quote.lines.find((l) => l.label.startsWith(a.name));
    assert.ok(line, `${a.code} should be listed`);
    assert.equal(line.amountCents, 0, `${a.code} must be free on a move out`);
  }

  // Derived from the catalog rather than listed, so a seventh add-on added
  // tomorrow is covered without anybody remembering to come back here.
  assert.deepEqual(
    [...SERVICE_INCLUDES.move_out],
    ADD_ONS.map((a) => a.code),
  );
});

test("a standard clean still sells every add-on, because it includes none", () => {
  const quote = quoteFor({
    plan: "one_time",
    unitSize: "2br_2ba",
    serviceType: "standard",
    addOns: ADD_ONS.map((a) => a.code),
    hasPets: false,
  });

  const everything = ADD_ONS.reduce((sum, a) => sum + a.priceCents, 0);
  assert.equal(quote.totalCents, SERVICE_PRICES["2br_2ba"].standard + everything);
  assert.equal(SERVICE_INCLUDES.standard.length, 0, "upkeep includes no extras");
});

test("a membership never gets a deep clean's inclusions, because it never bought one", () => {
  // The first visit of a new membership is upgraded to a deep clean, but the
  // member bought "cleanings" and was never quoted a deep clean. Quoting them
  // free add-ons off the back of an upgrade nobody sold would be inventing an
  // entitlement, and the member cannot see the deep clean to know it happened.
  const quote = quoteFor({
    plan: "membership",
    unitSize: "2br_2ba",
    addOns: [...SERVICE_INCLUDES.deep],
    hasPets: false,
  });

  const memberRate = SERVICE_INCLUDES.deep.reduce(
    (sum, code) => sum + Math.round(addOnByCode(code)!.priceCents * 0.9),
    0,
  );
  assert.equal(
    quote.totalCents,
    Math.round(MEMBERSHIP_TIERS.twice_monthly.prices["2br_2ba"].monthlyCents * 0.85) +
      memberRate,
  );
});
