import { NextResponse } from "next/server";
import { generateUpcomingVisits } from "@/lib/membership-lifecycle";
import { sendScheduledEmails } from "@/lib/emails/scheduled";
import { isDatabaseConfigured } from "@/lib/db";

/**
 * The daily job: top up billing periods and scheduled visits for every live
 * subscription. It is idempotent, so running it twice in a day is harmless,
 * which matters because retries and manual runs both happen.
 *
 * Wired to Vercel Cron via vercel.json.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel Cron sends this header; a plain GET from the internet must not run
  // it. A missing secret refuses the request rather than skipping the check.
  // "No secret is configured" and "anybody may run this" are very different
  // things, and the old form conflated them: any environment without the
  // variable, most likely a preview deployment pointing at the same database,
  // was a public URL that wrote to the schedule.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set; refusing to run.");
    return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 503 });
  }

  try {
    const generated = await generateUpcomingVisits();

    // Email runs after generation and in its own try, so a mail provider
    // having a bad morning cannot stop visits being created. Losing a day of
    // scheduling is a real problem. Losing a day of reminders is not.
    let emails = { remindersSent: 0, nudgesSent: 0 };
    try {
      emails = await sendScheduledEmails();
    } catch (err) {
      console.error("Scheduled email failed", err);
    }

    return NextResponse.json({ ok: true, ...generated, ...emails });
  } catch (err) {
    console.error("Daily generation failed", err);
    return NextResponse.json({ error: "Generation failed." }, { status: 500 });
  }
}
