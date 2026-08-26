import { SERVICE_INCLUDES, addOnByCode, type ServiceType } from "./pricing";

/**
 * What a cleaner is expected to do, by service.
 *
 * Hardcoded rather than editable, because this is the definition of the
 * service rather than a per-job note. A standard clean is the same standard
 * clean at every address, and a list somebody can edit per booking is a list
 * that drifts until two cleaners are doing two different jobs under one name.
 *
 * A cleaner is never shown "everything in Standard, plus". They get one flat
 * list of everything on this job, which is why the extra work below is merged
 * into the room it belongs to rather than appended as its own tier. Nobody
 * standing in a kitchen should have to cross-reference two sections to find
 * out whether the range hood is theirs.
 *
 * Anything specific to one address still goes in the booking notes, which the
 * job page shows separately under "The customer asked".
 */

export type ChecklistSection = { title: string; items: string[] };

const KITCHEN = "Kitchen";
const BATHROOMS = "Bathrooms";
const LIVING = "Bedrooms and living areas";
const THROUGHOUT = "Throughout";

const STANDARD: ChecklistSection[] = [
  {
    title: KITCHEN,
    items: [
      "Counters, backsplash, and exterior of appliances",
      "Sink scrubbed and drain cleared of debris",
      "Cooktop and exterior of oven",
      "Microwave inside and out",
      "Cabinet fronts wiped",
      "Trash emptied and liner replaced",
    ],
  },
  {
    title: BATHROOMS,
    items: [
      "Toilet cleaned inside and out",
      "Shower, tub, and tile scrubbed",
      "Sink, counter, and mirror",
      "Chrome fixtures wiped and shined",
      "Floors washed",
    ],
  },
  {
    title: LIVING,
    items: [
      // Unconditional, because that is what the customer was sold. The
      // pricing page says "Bed linens changed · Included", the services page
      // says "included on every clean", and clause 7 of the agreement names
      // it. A conditional instruction here would be the cleaner being told
      // something different to what was promised.
      "Beds made and linens changed",
      "Surfaces dusted, including sills and reachable ledges",
      "Ceiling fans dusted",
      "Light fixtures dusted",
      "Floors vacuumed and hard floors mopped",
      "Mirrors and glass",
    ],
  },
  {
    title: THROUGHOUT,
    items: [
      "Light switches, door handles, and other touch points",
      "Baseboards where reachable",
      "Cobwebs and high corners",
      "Trash collected and taken to the bin",
      "Final walk-through",
    ],
  },
];

/**
 * What a deep clean adds, filed under the room it happens in.
 *
 * "Detail work" has no equivalent in the standard list, so it becomes its own
 * section rather than being spread across four.
 */
const DEEP_ADDS: ChecklistSection[] = [
  {
    title: KITCHEN,
    items: [
      "Behind and beneath the refrigerator and stove",
      "Range hood and filter degreased",
      "Backsplash and cabinet fronts degreased",
    ],
  },
  {
    title: BATHROOMS,
    items: ["Shower door tracks detailed", "Hard water and mineral buildup treated"],
  },
  {
    title: LIVING,
    items: ["Under beds and closet floors", "Baseboards behind furniture"],
  },
  {
    title: "Detail work",
    items: [
      "Baseboards, doors, and door frames in detail",
      "Buildup on tile grout and fixtures",
      "Interior window sills and tracks",
      "Blinds dusted",
      "Vents and air returns",
      "Behind and beneath movable furniture",
    ],
  },
];

/** A move in and out is a deep clean plus everything an empty unit needs. */
const MOVE_OUT_ADDS: ChecklistSection[] = [
  {
    title: "Empty unit",
    items: [
      "Inside oven",
      "Inside refrigerator",
      "Cabinet and drawer interiors",
      "Interior windows, sills, and tracks",
      "Inside closets and shelving",
      "Laundry room, including behind machines where accessible",
      "Garage door interior and entry areas",
    ],
  },
];

/** Fold one set of sections into another, matching on the room name. */
function merge(base: ChecklistSection[], extra: ChecklistSection[]): ChecklistSection[] {
  const out = base.map((s) => ({ title: s.title, items: [...s.items] }));
  for (const section of extra) {
    const existing = out.find((s) => s.title === section.title);
    if (existing) existing.items.push(...section.items);
    else out.push({ title: section.title, items: [...section.items] });
  }
  return out;
}

/**
 * Add-ons this service covers for free that the list above does not already
 * name, so a cleaner is told to do the thing the customer was told they get.
 *
 * Filtered rather than appended blindly. A move in and out already spells out
 * the oven, the fridge, the cabinets and the windows, and a checklist that
 * lists the fridge twice is a checklist people stop reading properly.
 */
function uncoveredIncludedAddOns(
  serviceType: ServiceType,
  sections: ChecklistSection[],
): string[] {
  const written = sections
    .flatMap((s) => s.items)
    .join(" ")
    .toLowerCase();

  return SERVICE_INCLUDES[serviceType]
    .map((code) => addOnByCode(code)?.name)
    .filter((name): name is string => Boolean(name))
    .filter((name) => {
      // "Inside refrigerator" is covered by "Inside refrigerator"; "Interior
      // windows" by "Interior windows, sills, and tracks". Matched on the
      // distinctive noun rather than the whole label.
      const key = name.toLowerCase().replace(/^inside |^interior /, "").split(",")[0];
      return !written.includes(key);
    });
}

export function checklistFor(serviceType: ServiceType): ChecklistSection[] {
  const sections =
    serviceType === "standard"
      ? STANDARD.map((s) => ({ title: s.title, items: [...s.items] }))
      : serviceType === "deep"
        ? merge(STANDARD, DEEP_ADDS)
        : merge(merge(STANDARD, DEEP_ADDS), MOVE_OUT_ADDS);

  const extra = uncoveredIncludedAddOns(serviceType, sections);
  return extra.length
    ? [...sections, { title: "Included with this service, at no charge", items: extra }]
    : sections;
}

/** How many things are on it, for the assignment email. */
export function checklistLength(serviceType: ServiceType): number {
  return checklistFor(serviceType).reduce((n, s) => n + s.items.length, 0);
}
