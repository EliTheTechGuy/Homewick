import type { Metadata } from "next";
import { AdminSignInForm } from "@/components/admin/AdminSignInForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * Deliberately unlike the public site: dark, centred, one card, no navigation
 * anywhere. Somebody who lands here by mistake should be able to tell in a
 * glance that this is not the place to book a cleaning, and somebody who meant
 * to come here should not have to hunt for the form.
 */
export default function AdminSignInPage() {
  return (
    <div className="flex min-h-[calc(100dvh-61px)] flex-col items-center justify-center bg-navy px-5 py-16">
      <div className="w-full max-w-sm">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-white/55">
          Staff access
        </p>

        <div className="mt-5 rounded-2xl bg-white p-7 shadow-xl">
          <h1 className="text-lg font-semibold text-navy">Sign in</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Sessions last 30 days from last use, so this should be rare.
          </p>
          <AdminSignInForm />
        </div>

        <p className="mt-6 text-center text-xs text-white/45">
          Looking to book a cleaning? That is at homewickcleaning.net.
        </p>
      </div>
    </div>
  );
}
