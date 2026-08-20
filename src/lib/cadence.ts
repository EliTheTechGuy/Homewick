/**
 * How often somebody is billed and cleaned, in words.
 *
 * The account used to say "a month" for everybody, which is true of the
 * published membership and wrong for anything arranged by hand. Somebody
 * billed every 21 days is charged about 17 times a year, not 12, and telling
 * them otherwise is a bill they did not expect.
 */
export function cadenceLabel(intervalDays: number | null): string {
  if (intervalDays == null) return "a month";
  if (intervalDays % 7 === 0) {
    const weeks = intervalDays / 7;
    return weeks === 1 ? "a week" : `every ${weeks} weeks`;
  }
  return `every ${intervalDays} days`;
}

/** The same thing where a noun reads better than a preposition. */
export function periodNoun(intervalDays: number | null): string {
  return intervalDays == null ? "This month" : "This period";
}
