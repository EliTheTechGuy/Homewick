import type { Metadata } from "next";
import { Section } from "@/components/ui";
import { ConfirmSignIn } from "@/components/account/ConfirmSignIn";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * The page the emailed link opens.
 *
 * It deliberately does not sign anyone in. Loading this page only shows a
 * button, and the button posts the token to complete sign in.
 *
 * The reason is Outlook. Microsoft Defender Safe Links visits every URL in an
 * incoming message to scan it, and Gmail and various security appliances do
 * the same. When signing in happened on the GET, that scan spent the one time
 * token before the member ever clicked, and the member was told their brand
 * new link had expired. Scanners follow links. They do not submit forms.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <Section>
      <ConfirmSignIn token={token ?? ""} />
    </Section>
  );
}
