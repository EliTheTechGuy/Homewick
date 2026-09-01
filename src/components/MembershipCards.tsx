import { ButtonLink, Card } from "./ui";
import { formatCents } from "@/lib/money";
import {
  MEMBERSHIP_FREQUENCIES,
  MEMBERSHIP_TIERS,
  MOST_POPULAR_SIZE,
  UNIT_SIZES,
} from "@/lib/pricing";

/**
 * Both membership tiers, every size, all on the page at once.
 *
 * This was a toggle first, which kept the grid to three cards. The trouble
 * with a toggle on a pricing page is that half the offer is behind a control
 * somebody has to notice and press, and most people scanning a price do
 * neither. A customer who never presses it leaves believing there is one way
 * to be a member.
 *
 * Six cards is more page, so each row says what it is before the numbers
 * arrive. The rows are ordered with the discounted tier first because it is
 * the one worth choosing.
 */
export function MembershipCards({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-14 ${className}`}>
      {MEMBERSHIP_FREQUENCIES.map((frequency) => {
        const tier = MEMBERSHIP_TIERS[frequency];
        const discounted = tier.firstMonthDiscount > 0;

        return (
          <section key={frequency}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-hairline pb-4">
              <h3 className="text-xl font-semibold text-navy">{tier.label}</h3>
              {discounted && (
                <span className="rounded-full bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent">
                  Best value
                </span>
              )}
              <p className="text-sm text-muted">{tier.blurb}</p>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {UNIT_SIZES.map((size) => {
                const price = tier.prices[size.id];
                // Only on the tier worth steering somebody toward. The same
                // badge on both rows would say the size is popular, which is
                // not the choice this page is asking anybody to make.
                const popular = discounted && size.id === MOST_POPULAR_SIZE;

                return (
                  <Card key={size.id} highlighted={popular} className="flex flex-col">
                    {popular && (
                      <span className="mb-4 self-start rounded-full bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white">
                        Most popular
                      </span>
                    )}
                    <h4 className="text-lg font-semibold text-navy">{size.label}</h4>
                    <p className="mt-3 text-4xl font-semibold text-accent">
                      {formatCents(price.monthlyCents)}
                      <span className="text-base font-medium text-muted">/month</span>
                    </p>
                    <p className="mt-3 text-sm text-body">
                      {tier.visitsPerPeriod === 1
                        ? "One cleaning a month"
                        : `${tier.visitsPerPeriod} cleanings · ${formatCents(price.perVisitCents)} each`}
                    </p>
                    {/* The saving is the headline on the discounted tier and a
                        footnote on the other, because there it is a few dollars
                        and dressing that up as a saving would be noticed the
                        moment somebody does the arithmetic. */}
                    <p
                      className={
                        discounted
                          ? "mt-1 text-sm font-medium text-accent"
                          : "mt-1 text-sm text-muted"
                      }
                    >
                      {discounted
                        ? `Save ${formatCents(price.savesCents)} a month`
                        : `${formatCents(price.savesCents)} under the one-time rate`}
                    </p>
                    {/* mt-auto keeps the buttons on a line across all three
                        cards, even though one carries an extra badge. */}
                    <div className="mt-auto pt-7">
                      <ButtonLink
                        href={`/book?plan=membership&size=${size.id}&freq=${frequency}`}
                        variant={popular ? "primary" : "secondary"}
                        className="w-full"
                      >
                        Become a member
                      </ButtonLink>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
