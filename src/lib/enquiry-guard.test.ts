import assert from "node:assert/strict";
import { test } from "vitest";
import { isBotSubmission } from "./enquiry-guard";

/**
 * The empty case is the one that matters.
 *
 * Every genuine submission sends this field as an empty string, because the
 * input is on the page and nobody typed in it. If empty ever counted as a
 * bot, every real quote request would be silently dropped and answered with a
 * success message, and the first sign of it would be the phone not ringing.
 */
test("an untouched honeypot is not a bot", () => {
  assert.equal(isBotSubmission(""), false, "every real submission sends an empty string");
  assert.equal(isBotSubmission("   "), false, "whitespace is still nobody typing");
  assert.equal(isBotSubmission(null), false, "a form without the field at all");
  assert.equal(isBotSubmission(undefined), false);
});

test("anything typed into the honeypot is a bot", () => {
  assert.equal(isBotSubmission("Acme Ltd"), true);
  assert.equal(isBotSubmission("x"), true);
  assert.equal(isBotSubmission("  padded  "), true, "trimmed content still counts");
});
