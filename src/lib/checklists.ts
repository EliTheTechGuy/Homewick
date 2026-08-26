import { SERVICE_INCLUDES, addOnByCode, type ServiceType } from "./pricing";

/**
 * What a cleaner is expected to do, by service.
 *
 * Hardcoded rather than editable, because this is the definition of the
 * service rather than a per-job note. A standard clean is the same standard
 * clean at every address, and a list somebody can edit per booking is a list
 * that drifts until two cleaners are doing two different jobs under one name.
 *
 * Deliberately built from the same wording the site already uses on the
 * apartments page. What a customer is promised and what a cleaner is told to
 * do have to be the same sentences, or the guarantee is being made against a
 * different job to the one being done.
 *
 * Anything specific to one place still goes in the booking notes, which the
 * job page already shows under "The customer asked".
 */

export type ChecklistSection = { title: string; items: string[] };

const BASE: ChecklistSection[] = [
  {
    title: "Kitchen",
    items: [
      "Counters, backsplash, and exterior of appliances",
      "Sink scrubbed and drain cleared of debris",
      "Cooktop and exterior of oven and microwave",
      "Cabinet fronts wiped",
      "Trash emptied and liner replaced",
    ],
  },
  {
    title: "Bathrooms",
    items: [
      "Toilet cleaned inside and out",
      "Shower, tub, and tile scrubbed",
      "Sink, counter, and mirror",
      "Floors washed",
    ],
  },
  {
    title: "Bedrooms and living areas",
    items: [
      "Bed linens changed",
      "Surfaces dusted, including sills and reachable ledges",
      "Floors vacuumed and hard floors mopped",
      "Mirrors and glass",
    ],
  },
  {
    title: "Throughout",
    items: [
      "Light switches, door handles, and other touch points",
      "Baseboards where reachable",
      "Trash collected and taken to the bin",
    ],
  },
];

/** What the thorough services add on top of the base. */
const EXTRA: Record<ServiceType, ChecklistSection[]> = {
  standard: [],
  deep: [
    {
      title: "Deep clean, on top of the above",
      items: [
        "Baseboards and door frames in detail",
        "Buildup on tile grout and fixtures",
        "Interior window sills and tracks",
        "Behind and beneath movable furniture",
      ],
    },
  ],
  move_out: [
    {
      title: "Move in and out, on top of the above",
      items: [
        "Inside all cabinets and drawers",
        "Closets and shelving",
        "Inside the washer and dryer where present",
        "Left to the condition a leasing office inspects against",
      ],
    },
  ],
};

/**
 * The whole list for a visit, including anything the service covers for free.
 *
 * The included add-ons are pulled in from the pricing catalog rather than
 * typed out again. They are already free on a deep clean and on a move in and
 * out, and a cleaner who is not told to do the fridge will not do the fridge,
 * which is how a customer ends up paying for something nobody did.
 */
export function checklistFor(serviceType: ServiceType): ChecklistSection[] {
  const covered = SERVICE_INCLUDES[serviceType]
    .map((code) => addOnByCode(code)?.name)
    .filter((name): name is string => Boolean(name));

  return [
    ...BASE,
    ...EXTRA[serviceType],
    ...(covered.length
      ? [{ title: "Included with this service, at no charge", items: covered }]
      : []),
  ];
}

/** How many things are on it, for the assignment email. */
export function checklistLength(serviceType: ServiceType): number {
  return checklistFor(serviceType).reduce((n, s) => n + s.items.length, 0);
}
