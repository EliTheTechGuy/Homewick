import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Section } from "@/components/ui";
import { unsubscribeTokenValid } from "@/lib/unsubscribe-links";
import { ConfirmUnsubscribe } from "@/components/ConfirmUnsubscribe";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stop these reminders",
  robots: { index: false, follow: false },
};

/**
 * Nothing happens on arrival.
 *
 * Outlook and other mail providers follow links in messages to scan them. A
 * page that acted on a GET would unsubscribe people who never clicked, which
 * is how sign-in tokens were being burned here before the same fix. The
 * button is the action.
 */
export default async function UnsubscribePage({
  params,
}: PageProps<"/unsubscribe/[customerId]/[token]">) {
  const { customerId, token } = await params;
  if (!unsubscribeTokenValid(customerId, token)) notFound();

  return (
    <Section>
      <div className="max-w-lg">
        <h1 className="text-3xl font-semibold text-navy">Stop these reminders?</h1>
        <p className="mt-4 leading-relaxed text-body">
          This stops the monthly message about choosing your free add-on. You
          will still get everything about your actual cleanings: the reminder
          the morning before, booking confirmations, and anything we need to ask
          you about access.
        </p>
        <ConfirmUnsubscribe customerId={customerId} token={token} />
      </div>
    </Section>
  );
}
