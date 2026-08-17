/**
 * Site-wide constants.
 *
 * The email domain is an open decision. The address in use is
 * info@homewickcleaning.com but the domain actually owned is the .net.
 * It is read from the environment rather than hardcoded, and contact
 * details simply do not render until it is set.
 */
export const site = {
  name: "Homewick Cleaning",
  legalEntity: "Mabaje & Co LLC",
  serviceArea: "Dallas-Fort Worth Metroplex",
  /** Unset until the domain question is settled. */
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null,
  /**
   * Where a customer can leave a public review, shown to everyone after they
   * give feedback regardless of what they scored. Unset until a Google
   * Business Profile exists, and the thank you page simply omits it.
   */
  reviewUrl: process.env.NEXT_PUBLIC_REVIEW_URL ?? null,
  phone: process.env.NEXT_PUBLIC_CONTACT_PHONE ?? null,
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  /**
   * Where operator alerts go when a booking is paid. Server-side only, and
   * deliberately not NEXT_PUBLIC: this address is for running the business,
   * not for customers, and it should never reach the browser bundle.
   *
   * Unset means no alerts are sent and nothing errors, which is the right
   * behaviour for a preview deployment.
   */
  ownerEmail: process.env.OWNER_ALERT_EMAIL ?? null,
} as const;

/** Bumped whenever the privacy policy changes. Shown on the page so a customer,
 * or a carrier reviewing a messaging campaign, can see which version they read. */
export const PRIVACY_VERSION = "2026-08-16";

/** Bumped whenever the service agreement text changes; recorded on acceptance. */
export const TERMS_VERSION = "2026-08-16";
