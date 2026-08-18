import { stripe } from "./stripe";
import { UNIT_SIZES, unitSizeLabel, type UnitSize } from "./pricing";

/**
 * One Stripe product per apartment size, owned by us.
 *
 * Checkout used to let Stripe invent a product from inline price data. Stripe
 * owns those: they cannot be renamed, and they are deactivated once the
 * session closes, so a later price change cannot attach to them. Worse, a
 * discount cannot be restricted to a product whose id nobody knew in advance.
 *
 * Found by metadata rather than by name, so renaming one in the dashboard
 * does not orphan it.
 */
export async function membershipProductId(size: UnitSize): Promise<string> {
  const s = stripe();
  const found = await s.products.search({
    query: `active:'true' AND metadata['homewick_unit_size']:'${size}'`,
    limit: 1,
  });
  if (found.data[0]) return found.data[0].id;

  const created = await s.products.create({
    name: `Homewick Membership, ${unitSizeLabel(size)}`,
    description: "Two cleanings per billing period, one free add-on each period.",
    metadata: { homewick_unit_size: size },
  });
  return created.id;
}

/**
 * Every membership product, creating any that are missing.
 *
 * Exists because the first-month coupon has to be restricted to all of them at
 * once. Stripe fixes a coupon's applies_to at creation and refuses to change
 * it afterwards, so a coupon built around whichever size happened to book
 * first would never discount the other two, and nothing would say so: the
 * member simply pays full price for a month the pricing page promised at 15%
 * off.
 *
 * Sequential rather than parallel. These run inside a checkout request, and
 * three concurrent search-or-create calls against the same account is how you
 * get duplicate products on a cold start.
 */
export async function allMembershipProductIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const { id } of UNIT_SIZES) {
    ids.push(await membershipProductId(id));
  }
  return ids;
}
