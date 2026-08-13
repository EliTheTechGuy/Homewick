import type { Metadata } from "next";
import { ButtonLink, Card, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Booking received",
};

export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <Section>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">Booking received</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          We have your details. You will get a text confirming the date and arrival window
          before your first visit.
        </p>

        {ref && (
          <Card className="mt-8">
            <p className="text-sm text-muted">Your reference</p>
            <p className="mt-1 font-mono text-sm text-navy">{ref}</p>
          </Card>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/">Back to home</ButtonLink>
          <ButtonLink href="/terms" variant="secondary">
            Service agreement
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
