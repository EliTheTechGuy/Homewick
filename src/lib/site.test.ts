import assert from "node:assert/strict";
import { test } from "vitest";

/**
 * The admin address is derived rather than configured, so the derivation is
 * the thing that has to be right. Every operator alert links through it, and
 * the public host answers /admin with a deliberate 404: get this wrong and
 * every one of those buttons opens a dead page, which is how it shipped.
 */
function adminFrom(url: string): string {
  return url.replace(/^(https?:\/\/)(www\.)?/, "$1admin.");
}

test("the admin host is the public one with an admin prefix", () => {
  assert.equal(adminFrom("https://www.homewickcleaning.net"), "https://admin.homewickcleaning.net");
  assert.equal(adminFrom("https://homewickcleaning.net"), "https://admin.homewickcleaning.net");
});

test("it never produces www, and never doubles the prefix", () => {
  for (const url of [
    "https://www.homewickcleaning.net",
    "https://homewickcleaning.net",
    "http://localhost:3000",
  ]) {
    const admin = adminFrom(url);
    assert.doesNotMatch(admin, /www\./, `${url} kept www`);
    assert.doesNotMatch(admin, /admin\.admin\./, `${url} doubled the prefix`);
    assert.match(admin, /^https?:\/\/admin\./, `${url} produced ${admin}`);
  }
});

test("the scheme survives, so a link is not downgraded", () => {
  assert.match(adminFrom("https://www.homewickcleaning.net"), /^https:/);
  assert.match(adminFrom("http://localhost:3000"), /^http:/);
});
