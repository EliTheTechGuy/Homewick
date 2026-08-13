import { ButtonLink, Card } from "./ui";
import { formatCents } from "@/lib/money";
import {
  MEMBERSHIP_PRICES,
  MOST_POPULAR_SIZE,
  UNIT_SIZES,
  VISITS_PER_PERIOD,
} from "@/lib/pricing";

export function MembershipCards({ className = "" }: { className?: string }) {
  return (
    <div className={`grid gap-6 md:grid-cols-3 ${className}`}>
      {UNIT_SIZES.map((size) => {
        const price = MEMBERSHIP_PRICES[size.id];
        const popular = size.id === MOST_POPULAR_SIZE;

        return (
          <Card key={size.id} highlighted={popular} className="flex flex-col">
            {popular && (
              <span className="mb-4 self-start rounded-full bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white">
                Most popular
              </span>
            )}
            <h3 className="text-lg font-semibold text-navy">{size.label}</h3>
            <p className="mt-3 text-4xl font-semibold text-accent">
              {formatCents(price.monthlyCents)}
              <span className="text-base font-medium text-muted">/month</span>
            </p>
            <p className="mt-3 text-sm text-body">
              {VISITS_PER_PERIOD} cleanings · {formatCents(price.perVisitCents)} each
            </p>
            <p className="mt-1 text-sm font-medium text-accent">
              Save {formatCents(price.savesCents)} a month
            </p>
            {/* mt-auto keeps the buttons on a line across all three cards, even
                though the popular one carries an extra badge. */}
            <div className="mt-auto pt-7">
              <ButtonLink
                href={`/book?plan=membership&size=${size.id}`}
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
  );
}
