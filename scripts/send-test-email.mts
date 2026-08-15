/**
 * Send the real transactional templates to an address, with sample data.
 *
 *   npm run email:test -- you@example.com
 *   npm run email:test -- you@example.com membership
 *
 * Imports the same template functions the webhook uses, so what lands in the
 * inbox is what a customer gets — not a copy that drifts. Rendering an email
 * in a browser tells you nothing about how Gmail and Outlook will treat it.
 */

import { readFileSync } from "node:fs";
import { membershipWelcomeEmail, oneTimeBookingEmail } from "../src/lib/emails/templates";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
    break;
  } catch {
    // try the next candidate
  }
}

const to = process.argv[2];
const only = process.argv[3];

if (!to) {
  console.error("\nUsage: npm run email:test -- you@example.com [one_time|membership]\n");
  process.exit(1);
}

const missing = ["RESEND_API_KEY", "EMAIL_FROM"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `\nMissing ${missing.join(" and ")} in .env.local.\n\n` +
      `Copy them from Vercel → Settings → Environment Variables.\n` +
      `EMAIL_FROM should be:  "Homewick Cleaning <noreply@send.homewickcleaning.net>"\n`,
  );
  process.exit(1);
}

const samples = {
  one_time: oneTimeBookingEmail({
    firstName: "Elisha",
    serviceType: "deep",
    unitSize: "2br_2ba",
    onDate: "2026-08-27",
    address: "900 Ross Ave, Apt 7, Dallas, TX 75202",
    amountCents: 23900,
  }),
  membership: membershipWelcomeEmail({
    firstName: "Elisha",
    unitSize: "2br_2ba",
    monthlyAmountCents: 26900,
    firstPaymentCents: 22865,
    visitDates: ["2026-08-20", "2026-09-03"],
    address: "900 Ross Ave, Apt 7, Dallas, TX 75202",
  }),
};

const chosen = only ? [only] : Object.keys(samples);

for (const key of chosen) {
  const message = samples[key as keyof typeof samples];
  if (!message) {
    console.error(`Unknown template "${key}". Use one_time or membership.`);
    process.exit(1);
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      // Flagged so a test never gets mistaken for a real confirmation.
      subject: `[TEST] ${message.subject}`,
      text: message.text,
      html: message.html,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (response.ok) {
    console.log(`sent ${key} -> ${to}  (resend id ${(body as { id?: string }).id ?? "?"})`);
  } else {
    console.error(`FAILED ${key}: ${response.status} ${JSON.stringify(body)}`);
    process.exitCode = 1;
  }
}
