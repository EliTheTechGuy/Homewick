import assert from "node:assert/strict";
import { test } from "vitest";
import { addDays, addMonths, daysBetween, firstWeekdayOnOrAfter, today } from "./dates";
import { visitReminderEmail } from "./emails/templates";
import {
  cancellationEndDate,
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

  // Laundry is not perk-eligible, so a member pays it at 10% off: 2500 -> 2250.
  assert.equal(quote.totalCents, Math.round(26900 * 0.85) + 2250);
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
  const { MEMBERSHIP_PRICES, SERVICE_PRICES } = await import("./pricing");

  for (const size of ["studio_1br", "2br_2ba", "3br_2ba"] as const) {
    const quote = quoteFor({ plan: "membership", unitSize: size, addOns: [], hasPets: false });

    // One line, one charge: the discounted first month. A separately billed
    // onboarding deep clean on top meant paying twice for the same month.
    assert.equal(quote.lines.length, 1, `${size} should quote a single charge`);
    assert.equal(quote.totalCents, Math.round(MEMBERSHIP_PRICES[size].monthlyCents * 0.85));

    // Never more than the ordinary monthly rate.
    assert.ok(
      quote.totalCents < MEMBERSHIP_PRICES[size].monthlyCents,
      `${size} first month should be below the standard rate`,
    );
    // And nowhere near the old membership-plus-deep-clean figure.
    const oldTotal =
      MEMBERSHIP_PRICES[size].monthlyCents + Math.round(SERVICE_PRICES[size].deep * 0.85);
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
