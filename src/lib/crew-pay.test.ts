import assert from "node:assert/strict";
import { test } from "vitest";
import {
  LEAD_PREMIUM_CENTS,
  splitHousePay,
  visitPriceCents,
  type CrewMember,
} from "./crew-pay";

const lead: CrewMember = { cleanerId: "lead", isLead: true };
const second: CrewMember = { cleanerId: "second", isLead: false };
const third: CrewMember = { cleanerId: "third", isLead: false };

function total(payouts: { payCents: number }[]): number {
  return payouts.reduce((sum, p) => sum + p.payCents, 0);
}

test("house pay: the worked example, 4 bed 3 bath at $195 with a crew of two", () => {
  const out = splitHousePay(19500, [lead, second]);
  assert.equal(out.find((p) => p.isLead)!.payCents, 5625);
  assert.equal(out.find((p) => !p.isLead)!.payCents, 4125);
  assert.equal(total(out), 9750);
});

test("house pay: payouts always sum to exactly half the job", () => {
  for (const price of [15000, 19000, 25000, 30000, 36000, 42000, 48000, 28000, 88000]) {
    for (const crew of [[lead], [lead, second], [lead, second, third]]) {
      assert.equal(
        total(splitHousePay(price, crew)),
        Math.round(price * 0.5),
        `price ${price}, crew ${crew.length}`,
      );
    }
  }
});

test("house pay: a solo cleaner takes the whole pool, not a premium plus a share", () => {
  const out = splitHousePay(15000, [lead]);
  assert.equal(out.length, 1);
  assert.equal(out[0].payCents, 7500);
});

test("house pay: leftover pennies go to the lead rather than evaporating", () => {
  // $190 pool is $95.00, less $15 is $80.00, which does not divide by three.
  const out = splitHousePay(19000, [lead, second, third]);
  const leadPay = out.find((p) => p.isLead)!.payCents;
  const others = out.filter((p) => !p.isLead).map((p) => p.payCents);
  assert.equal(total(out), 9500);
  assert.ok(leadPay > others[0], "lead should carry the remainder");
  assert.equal(others[0], others[1], "non-leads are paid equally");
});

test("house pay: the lead is always ahead by at least the premium", () => {
  const out = splitHousePay(48000, [lead, second]);
  const leadPay = out.find((p) => p.isLead)!.payCents;
  const otherPay = out.find((p) => !p.isLead)!.payCents;
  assert.ok(leadPay - otherPay >= LEAD_PREMIUM_CENTS);
});

test("house pay: refuses a crew without exactly one lead", () => {
  assert.throws(() => splitHousePay(19500, [second, third]));
  assert.throws(() => splitHousePay(19500, [lead, { cleanerId: "x", isLead: true }]));
});

test("house pay: refuses a job too small to carry the premium across a crew", () => {
  // A $20 job has a $10 pool, which cannot fund a $15 premium.
  assert.throws(() => splitHousePay(2000, [lead, second]));
});

test("visit price: a one-off is worth what it charges", () => {
  assert.equal(
    visitPriceCents({
      baseCents: 19500,
      petSurchargeCents: 1500,
      addOnsCents: 0,
      subscriptionAmountCents: null,
      visitsPerPeriod: null,
    }),
    21000,
  );
});

/**
 * The trap this function exists for. A recurring visit is created with
 * base_amount_cents at its default of zero, so reading the visit alone pays
 * the crew half of nothing.
 */
test("visit price: a recurring visit falls back to its share of the subscription", () => {
  assert.equal(
    visitPriceCents({
      baseCents: 0,
      petSurchargeCents: 0,
      addOnsCents: 0,
      subscriptionAmountCents: 19500,
      visitsPerPeriod: 1,
    }),
    19500,
  );
  assert.equal(
    visitPriceCents({
      baseCents: 0,
      petSurchargeCents: 0,
      addOnsCents: 0,
      subscriptionAmountCents: 26900,
      visitsPerPeriod: 2,
    }),
    13450,
  );
});

test("visit price: a zero everywhere is zero, not a crash", () => {
  assert.equal(
    visitPriceCents({
      baseCents: 0,
      petSurchargeCents: 0,
      addOnsCents: 0,
      subscriptionAmountCents: null,
      visitsPerPeriod: null,
    }),
    0,
  );
});
