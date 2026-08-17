import type { Metadata } from "next";
import { AdminSignInForm } from "@/components/admin/AdminSignInForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function AdminSignInPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-24">
      <h1 className="text-3xl font-semibold text-navy">Homewick admin</h1>
      <p className="mt-3 leading-relaxed text-muted">
        Signed-in sessions last 30 days from last use, so this should be rare.
      </p>
      <AdminSignInForm />
    </div>
  );
}
