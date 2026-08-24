import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CANCELLATION_NOTICE_HOURS,
  LATE_CANCELLATION_FEE_CENTS,
  cancellationFor,
} from "./cancellation";

const now = new Date("2026-09-01T15:00:00Z");
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

test("enough notice means everything back", () => {
  for (const hours of [CANCELLATION_NOTICE_HOURS, 72, 24 * 30]) {
    const c = cancellationFor({ paidCents: 22000, scheduledFor: inHours(hours), now });
    assert.equal(c.late, false, `${hours}h out should not be late`);
    assert.equal(c.feeCents, 0);
    assert.equal(c.refundCents, 22000, "the whole payment goes back");
  }
});

test("inside the window we keep the fee and refund the rest", () => {
  const c = cancellationFor({ paidCents: 22000, scheduledFor: inHours(12), now });
  assert.equal(c.late, true);
  assert.equal(c.feeCents, LATE_CANCELLATION_FEE_CENTS);
  assert.equal(c.refundCents, 22000 - LATE_CANCELLATION_FEE_CENTS);
});

test("the boundary is not late, and one hour inside it is", () => {
  // Somebody cancelling at exactly the notice they were promised has given
  // that notice. Off by one here is an argument with a customer holding the
  // terms page open.
  const onTime = cancellationFor({
    paidCents: 15900,
    scheduledFor: inHours(CANCELLATION_NOTICE_HOURS),
    now,
  });
  assert.equal(onTime.late, false);
  assert.equal(onTime.refundCents, 15900);

  const late = cancellationFor({
    paidCents: 15900,
    scheduledFor: inHours(CANCELLATION_NOTICE_HOURS - 1),
    now,
  });
  assert.equal(late.late, true);
});

test("the fee never exceeds what was paid, and a refund is never negative", () => {
  const c = cancellationFor({
    paidCents: 1500,
    scheduledFor: inHours(1),
    now,
  });
  assert.equal(c.feeCents, 1500, "we keep what there is, not more");
  assert.equal(c.refundCents, 0);
  assert.ok(c.refundCents >= 0, "a negative refund is a charge nobody agreed to");
});

test("a visit already in the past is late, not free", () => {
  const c = cancellationFor({ paidCents: 22000, scheduledFor: inHours(-3), now });
  assert.equal(c.late, true);
  assert.equal(c.hoursUntil, -3);
  assert.equal(c.feeCents, LATE_CANCELLATION_FEE_CENTS);
});
