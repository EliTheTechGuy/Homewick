import assert from "node:assert/strict";
import { test } from "vitest";
import { feedbackRequestEmail } from "./emails/templates";
import { today, addDays } from "./dates";

const url = "https://example.test/feedback/tok";

test("the scale is labelled at its ends rather than explained", () => {
  const m = feedbackRequestEmail({ firstName: "Andrea", onDate: today(), feedbackUrl: url });

  assert.match(m.html, /Not great/, "the 1 end needs a word under it");
  assert.match(m.html, /(^|[^a-z])Great</, "the 5 end needs a word under it");
  assert.doesNotMatch(
    m.text,
    /5 being great/,
    "explaining the scale is the step the labels remove",
  );
});

test("every score is a one tap link, and each carries its own score", () => {
  const m = feedbackRequestEmail({ firstName: "Andrea", onDate: today(), feedbackUrl: url });
  for (const n of [1, 2, 3, 4, 5]) {
    assert.ok(
      m.html.includes(`${url}?rating=${n}`),
      `${n} must be tappable straight from the email`,
    );
  }
});

test("it only claims to have cleaned today when it did", () => {
  const now = feedbackRequestEmail({ firstName: "Andrea", onDate: today(), feedbackUrl: url });
  assert.match(now.text, /cleaned your place today/);

  // The daily sweep catches visits the main path missed, sometimes days late.
  const late = feedbackRequestEmail({
    firstName: "Andrea",
    onDate: addDays(today(), -4),
    feedbackUrl: url,
  });
  assert.doesNotMatch(
    late.text,
    /cleaned your place today/,
    "a catch-up must not tell somebody we cleaned today",
  );
  assert.match(late.text, /cleaned your place on /);
});
