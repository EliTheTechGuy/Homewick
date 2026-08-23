import { stripe } from "./stripe";
import {
  MEMBERSHIP_TIERS,
  unitSizeLabel,
  type MembershipFrequency,
  type UnitSize,
} from "./pricing";

/**
 * One Stripe product per apartment size and membership tier, owned by us.
 *
 * Checkout used to let Stripe invent a product from inline price data. Stripe
 * owns those: they cannot be renamed, and they are deactivated once the
 * session closes, so a later price change cannot attach to them. Worse, a
 * discount cannot be restricted to a product whose id nobody knew in advance.
 *
 * Found by metadata rather than by name, so renaming one in the dashboard
 * does not orphan it.
 */

/**
 * The metadata value a product is found by.
 *
 * The twice-a-month tier deliberately keeps the bare size as its key, which is
 * what it has always been. Those three product ids are frozen inside the live
 * first-month coupon's applies_to, and Stripe refuses to change applies_to
 * after creation. Searching on a new key would have found nothing, created
 * three replacement products, and left every new member paying full price for
 * a first month the pricing page promises at 15% off. Nothing would have
 * errored.
 *
 * The once-a-month tier is suffixed, so it gets its own products and is
 * outside that coupon by construction. That is the correct answer for a tier
 * with no first-month discount.
 */
function productKey(
  size: UnitSize | null,
  frequency: MembershipFrequency,
): string {
  // A house has no unit size, so it gets its own product rather than being
  // filed under whichever apartment bracket it least resembles. Houses are
  // priced on a call, so one product covers all of them.
  if (size == null) return "house";
  return frequency === "twice_monthly" ? size : `${size}_x1`;
}

/**
 * The frequency is required rather than defaulted. A default here is a wrong
 * answer waiting to be given silently: it would put a once-a-month member on
 * the discounted tier's product and inside the coupon that comes with it.
 * A house ignores it, because a house has one product either way.
 */
export async function membershipProductId(
  size: UnitSize | null,
  frequency: MembershipFrequency,
): Promise<string> {
  const key = productKey(size, frequency);
  const s = stripe();

  const found = await s.products.search({
    query: `active:'true' AND metadata['homewick_unit_size']:'${key}'`,
    limit: 1,
  });
  if (found.data[0]) return found.data[0].id;

  const created = await s.products.create({
    name: productName(size, frequency),
    description: size
      ? `${MEMBERSHIP_TIERS[frequency].visitsPerPeriod === 1 ? "One cleaning" : "Two cleanings"} per billing period.`
      : "Recurring house cleaning on an agreed schedule.",
    metadata: { homewick_unit_size: key },
  });
  return created.id;
}

function productName(size: UnitSize | null, frequency: MembershipFrequency): string {
  if (!size) return "Homewick recurring clean, House";
  const label = unitSizeLabel(size);
  return frequency === "twice_monthly"
    ? `Homewick Membership, ${label}`
    : `Homewick Membership, ${label}, once a month`;
}

/**
 * Every product the first-month coupon covers, creating any that are missing.
 *
 * Exists because that coupon has to be restricted to all of them at once.
 * Stripe fixes a coupon's applies_to at creation and refuses to change it
 * afterwards, so a coupon built around whichever size happened to book first
 * would never discount the other two, and nothing would say so: the member
 * simply pays full price for a month the pricing page promised at 15% off.
 *
 * Only the twice-a-month tier. The once-a-month tier carries no first-month
 * discount, and adding its products here would widen a coupon it is not
 * entitled to.
 *
 * Sequential rather than parallel. These run inside a checkout request, and
 * three concurrent search-or-create calls against the same account is how you
 * get duplicate products on a cold start.
 */
export async function allMembershipProductIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const size of Object.keys(
    MEMBERSHIP_TIERS.twice_monthly.prices,
  ) as UnitSize[]) {
    ids.push(await membershipProductId(size, "twice_monthly"));
  }
  return ids;
}
