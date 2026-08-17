import type { Metadata } from "next";
import { ConfirmAdminSignIn } from "@/components/admin/ConfirmAdminSignIn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * Nothing is spent on arrival.
 *
 * Mail providers follow links to scan them, which burned member sign-in
 * tokens here before the same fix. The button is what consumes the link.
 */
export default async function AdminVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="mx-auto max-w-md px-5 py-24">
        <h1 className="text-2xl font-semibold text-navy">This link is incomplete</h1>
        <p className="mt-3 text-muted">Ask for a fresh one and open it directly.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 py-24">
      <h1 className="text-3xl font-semibold text-navy">Sign in to admin</h1>
      <p className="mt-3 leading-relaxed text-muted">
        You are one click away. This link works once.
      </p>
      <ConfirmAdminSignIn token={token} />
    </div>
  );
}
