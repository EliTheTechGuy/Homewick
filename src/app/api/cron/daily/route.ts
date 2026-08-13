import { NextResponse } from "next/server";
import { generateUpcomingVisits } from "@/lib/membership-lifecycle";
import { isDatabaseConfigured } from "@/lib/db";

/**
 * The daily job: top up billing periods and scheduled visits for every live
 * subscription. It is idempotent, so running it twice in a day is harmless —
 * which matters, because retries and manual runs both happen.
 *
 * Wired to Vercel Cron via vercel.json.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel Cron sends this header; a plain GET from the internet must not run it.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 503 });
  }

  try {
    const result = await generateUpcomingVisits();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Daily generation failed", err);
    return NextResponse.json({ error: "Generation failed." }, { status: 500 });
  }
}
