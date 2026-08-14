import type { Metadata } from "next";
import { Section } from "@/components/ui";
import { currentMember } from "@/lib/member-auth";
import { memberOverview } from "@/lib/member-account";
import { isDatabaseConfigured } from "@/lib/db";
import { SignInForm } from "@/components/account/SignInForm";
import { AccountHome } from "@/components/account/AccountHome";

export const metadata: Metadata = {
  title: "My account",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;

  if (!isDatabaseConfigured()) {
    console.error("Account page unavailable: DATABASE_URL is not set.");
    return (
      <Section>
        <div className="max-w-xl">
          <h1 className="text-3xl font-semibold text-navy">Unavailable</h1>
          <p className="mt-3 text-muted">
            Your account is not available right now. Please try again shortly.
          </p>
        </div>
      </Section>
    );
  }

  const member = await currentMember();

  if (!member) {
    return (
      <Section>
        <SignInForm linkExpired={expired === "1"} />
      </Section>
    );
  }

  const overview = await memberOverview(member.customerId);

  return (
    <Section>
      <AccountHome member={member} overview={overview} />
    </Section>
  );
}
