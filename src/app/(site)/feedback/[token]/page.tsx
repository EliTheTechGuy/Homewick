import type { Metadata } from "next";
import { Section } from "@/components/ui";
import { feedbackLinkStatus } from "@/actions/feedback";
import { FeedbackForm } from "@/components/FeedbackForm";

export const metadata: Metadata = {
  title: "How did we do?",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * The page a feedback link opens.
 *
 * Loading it records nothing. The rating in the query string only preselects a
 * score, and saving needs a submit, so a mail scanner opening every link in
 * the message cannot leave a one star review on somebody's behalf.
 */
export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ rating?: string }>;
}) {
  const { token } = await params;
  const { rating } = await searchParams;

  const status = await feedbackLinkStatus(token);

  if (!status.valid) {
    return (
      <Section>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold text-navy">That link has expired</h1>
          <p className="mt-4 leading-relaxed text-muted">
            We could not find that feedback request. If you still want to tell us how a
            clean went, get in touch and we will pass it on.
          </p>
        </div>
      </Section>
    );
  }

  const preselected = Number(rating);

  return (
    <Section>
      <FeedbackForm
        token={token}
        initialRating={
          Number.isInteger(preselected) && preselected >= 1 && preselected <= 5
            ? preselected
            : status.alreadyRated
        }
      />
    </Section>
  );
}
