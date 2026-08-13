/** Money is integer cents everywhere. Never floats. */

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const dollarsAndCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** $110 when even, $110.50 when not. */
export function formatCents(cents: number): string {
  return cents % 100 === 0 ? dollars.format(cents / 100) : dollarsAndCents.format(cents / 100);
}
