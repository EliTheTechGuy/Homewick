import assert from "node:assert/strict";
import { test } from "vitest";
import { checklistFor, checklistLength } from "./checklists";
import { SERVICE_INCLUDES, addOnByCode, type ServiceType } from "./pricing";

const ALL: ServiceType[] = ["standard", "deep", "move_out"];

test("a cleaner is never told to go and read another list", () => {
  // The whole point of merging by room. "Everything in Standard, plus" is a
  // fine way to describe a service to a customer and a useless way to hand
  // somebody a job.
  for (const service of ALL) {
    for (const section of checklistFor(service)) {
      assert.doesNotMatch(
        section.title,
        /on top of|everything in|plus/i,
        `${service} has a section that refers to another list: ${section.title}`,
      );
      for (const item of section.items) {
        assert.doesNotMatch(item, /see (the )?(standard|deep)/i);
      }
    }
  }
});

test("no room appears twice, so nothing has to be cross-referenced", () => {
  for (const service of ALL) {
    const titles = checklistFor(service).map((s) => s.title);
    assert.equal(
      new Set(titles).size,
      titles.length,
      `${service} lists a room more than once: ${titles.join(", ")}`,
    );
  }
});

test("everything a service covers for free is on its checklist", () => {
  // A cleaner who is not told to do the fridge will not do the fridge, and on
  // a deep clean that fridge is something the customer was told they get.
  for (const service of ALL) {
    const written = checklistFor(service)
      .flatMap((s) => s.items)
      .join(" ")
      .toLowerCase();

    for (const code of SERVICE_INCLUDES[service]) {
      const name = addOnByCode(code)!.name.toLowerCase();
      const key = name.replace(/^inside |^interior /, "").split(",")[0];
      assert.ok(
        written.includes(key),
        `${service} covers ${name} for free but never tells the cleaner to do it`,
      );
    }
  }
});

test("nothing is listed twice on the same job", () => {
  for (const service of ALL) {
    const items = checklistFor(service).flatMap((s) => s.items);
    assert.equal(
      new Set(items).size,
      items.length,
      `${service} repeats an item word for word`,
    );
  }
});

test("the thorough services cover more than the everyday one", () => {
  assert.ok(checklistLength("deep") > checklistLength("standard"));
  assert.ok(checklistLength("move_out") > checklistLength("deep"));
});

test("the linens line says what the customer was promised", () => {
  // The pricing page says "Bed linens changed · Included", the services page
  // says "included on every clean", and clause 7 of the agreement names it.
  // A conditional instruction here is the cleaner being told something other
  // than what was sold.
  for (const service of ALL) {
    const linens = checklistFor(service)
      .flatMap((s) => s.items)
      .find((i) => /linens/i.test(i));
    assert.ok(linens, `${service} never mentions linens`);
    assert.doesNotMatch(
      linens,
      /when|if|where left|provided/i,
      "linens are promised unconditionally, so they cannot be conditional here",
    );
  }
});
