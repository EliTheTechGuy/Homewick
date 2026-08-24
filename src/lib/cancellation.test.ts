import assert from "node:assert/strict";
import { test } from "vitest";
import {
  FREE_CANCELLATION_HOURS,
  NO_REFUND_HOURS,
  cancellationFor,
} from "./cancellation";

const now = new Date("2026-09-01T15:00:00Z");
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);
const at = (hours: number, paidCents = 22000) =>
  cancellationFor({ paidCents, scheduledFor: inHours(hours), now });

test("48 hours or more costs nothing", () => {
  for (const hours of [FREE_CANCELLATION_HOURS, 72, 24 * 30]) {
    const c = at(hours);
    assert.equal(c.tier, "free", `${hours}h out should be free`);
    assert.equal(c.feeCents, 0);
    assert.equal(c.refundCents, 22000, "the whole payment goes back");
  }
});

test("between 24 and 48 hours keeps half", () => {
  for (const hours of [NO_REFUND_HOURS, 36, FREE_CANCELLATION_HOURS - 1]) {
    const c = at(hours);
    assert.equal(c.tier, "half", `${hours}h out should be the half tier`);
    assert.equal(c.feeCents, 11000);
    assert.equal(c.refundCents, 11000);
  }
});

test("under 24 hours refunds nothing", () => {
  for (const hours of [NO_REFUND_HOURS - 1, 6, 0]) {
    const c = at(hours);
    assert.equal(c.tier, "full", `${hours}h out should be the full tier`);
    assert.equal(c.feeCents, 22000);
    assert.equal(c.refundCents, 0);
  }
});

test("both boundaries fall on the side the customer was promised", () => {
  // Somebody cancelling at exactly the notice the terms quote has given that
  // notice. Off by one here is an argument with a customer holding the terms
  // page open, and they would be right.
  assert.equal(at(FREE_CANCELLATION_HOURS).tier, "free");
  assert.equal(at(FREE_CANCELLATION_HOURS - 1).tier, "half");
  assert.equal(at(NO_REFUND_HOURS).tier, "half");
  assert.equal(at(NO_REFUND_HOURS - 1).tier, "full");
});

test("a half that does not divide evenly leaves the odd cent with the customer", () => {
  const c = at(30, 22865);
  assert.equal(c.feeCents, 11432);
  assert.equal(c.refundCents, 11433);
  assert.equal(c.feeCents + c.refundCents, 22865, "nothing may vanish in rounding");
  assert.ok(c.refundCents > c.feeCents, "the odd cent goes to them, not to us");
});

test("a lockout is a visit in the past, and is not refunded", () => {
  const c = at(-3);
  assert.equal(c.tier, "full");
  assert.equal(c.hoursUntil, -3);
  assert.equal(c.refundCents, 0);
});

test("a refund is never negative and a fee never exceeds what was paid", () => {
  for (const hours of [-10, 0, 12, 30, 47, 48, 500]) {
    for (const paid of [1500, 11000, 22000, 39900]) {
      const c = at(hours, paid);
      assert.ok(c.refundCents >= 0, "a negative refund is a charge nobody agreed to");
      assert.ok(c.feeCents <= paid);
      assert.equal(c.feeCents + c.refundCents, paid);
    }
  }
});
