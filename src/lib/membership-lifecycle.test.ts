import assert from "node:assert/strict";
import { test } from "vitest";
import { addDays, addMonths, firstWeekdayOnOrAfter, today } from "./dates";
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
  const dates = visitDatesForPeriod(period, 4, 2);

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
  const late = visitDatesForPeriod({ ...period, end: "2026-02-01" }, 4, 2);
  for (const d of late) {
    assert.ok(d < "2026-02-01", `${d} escaped a short period`);
  }
});

test("no preferred weekday falls back to the period start", () => {
  const dates = visitDatesForPeriod({ start: "2026-01-15", end: "2026-02-15" }, null, 2);
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
