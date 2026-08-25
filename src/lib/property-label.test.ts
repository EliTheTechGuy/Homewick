import assert from "node:assert/strict";
import { test } from "vitest";
import { propertyLabel } from "./pricing";

test("an apartment is described by its bracket", () => {
  assert.equal(propertyLabel({ unitSize: "2br_2ba" }), "2 Bed / 2 Bath");
  assert.equal(propertyLabel({ unitSize: "studio_1br" }), "Studio & 1 Bedroom");
});

test("a house is described by its shape, because it has no bracket", () => {
  // The case that reached a real customer: unit_size is null on a house, and
  // every email printed an empty value under the heading "Apartment".
  assert.equal(
    propertyLabel({ unitSize: null, bedrooms: 4, bathrooms: "3.0" }),
    "House, 4 bed 3 bath",
  );
  assert.equal(
    propertyLabel({ unitSize: null, bedrooms: 3, bathrooms: "2.5" }),
    "House, 3 bed 2.5 bath",
  );
});

test("a house with nothing recorded still says something", () => {
  // Houses entered before bedrooms and bathrooms existed have neither, and
  // "House" on its own beats a blank line next to the wrong word.
  assert.equal(propertyLabel({ unitSize: null }), "House");
  assert.equal(propertyLabel({ unitSize: null, bedrooms: 4 }), "House, 4 bed");
  assert.equal(
    propertyLabel({ unitSize: null, bathrooms: null, bedrooms: null }),
    "House",
  );
});

test("nothing it returns is ever empty", () => {
  const cases = [
    { unitSize: "3br_2ba" as const },
    { unitSize: null, bedrooms: 4, bathrooms: "3.0" },
    { unitSize: null, bedrooms: null, bathrooms: null },
    { unitSize: null, bathrooms: "not a number" },
  ];
  for (const c of cases) {
    const label = propertyLabel(c);
    assert.ok(label.trim().length > 0, `${JSON.stringify(c)} produced an empty label`);
  }
});
