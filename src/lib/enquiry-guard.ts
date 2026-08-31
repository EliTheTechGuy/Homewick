/**
 * Keeping junk out of the quote list without making real people work harder.
 *
 * The quote form asks for almost nothing on purpose, because every required
 * field is somewhere a person decides it is not worth the effort. That
 * openness is what let two submissions land with a country for an address, so
 * the answer has to be something a customer never sees rather than another
 * hoop for them to jump through.
 *
 * Two rules, neither of which touches what anybody has to type.
 */

/**
 * The hidden field's name. Deliberately something a form filler wants to
 * complete: "company" reads as an ordinary business field to a script
 * skimming the DOM, and means nothing to a person who cannot see it.
 */
export const HONEYPOT_FIELD = "company";

/** How many quote requests one address may send in the window below. */
export const ENQUIRY_LIMIT = 3;

/** The window the limit applies over. */
export const ENQUIRY_WINDOW = "1 hour";

/**
 * Whether the hidden field was filled in.
 *
 * Anything at all counts, including whitespace, because a person cannot type
 * into a field they cannot see and no browser fills it on its own. The field
 * carries autocomplete="off" for exactly that reason: a password manager
 * helpfully populating it would lock a real customer out of the form with no
 * explanation.
 */
export function isBotSubmission(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
