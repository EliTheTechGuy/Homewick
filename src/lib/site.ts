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
  phone: process.env.NEXT_PUBLIC_CONTACT_PHONE ?? null,
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;

/** Bumped whenever the service agreement text changes; recorded on acceptance. */
export const TERMS_VERSION = "2026-08-13";
