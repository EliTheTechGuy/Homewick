import assert from "node:assert/strict";
import { test } from "vitest";
import { cadenceLabel, periodNoun } from "./cadence";

test("cadence: null is the published monthly membership", () => {
  assert.equal(cadenceLabel(null), "a month");
  assert.equal(periodNoun(null), "This month");
});

test("cadence: whole weeks read as weeks, because that is how people say it", () => {
  assert.equal(cadenceLabel(7), "a week");
  assert.equal(cadenceLabel(14), "every 2 weeks");
  assert.equal(cadenceLabel(21), "every 3 weeks");
  assert.equal(cadenceLabel(28), "every 4 weeks");
});

test("cadence: anything else falls back to days rather than inventing a week", () => {
  assert.equal(cadenceLabel(10), "every 10 days");
  assert.equal(cadenceLabel(45), "every 45 days");
});

test("cadence: a custom interval never claims to be monthly", () => {
  assert.equal(periodNoun(21), "This period");
  assert.notEqual(cadenceLabel(21), "a month");
});
