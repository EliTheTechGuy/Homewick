"use client";

import { useEffect, useState, useTransition } from "react";
import { submitFeedback } from "@/actions/feedback";
import { site } from "@/lib/site";

const SCORES = [1, 2, 3, 4, 5];

export function FeedbackForm({
  token,
  initialRating,
}: {
  token: string;
  initialRating: number | null;
}) {
  const [rating, setRating] = useState<number | null>(initialRating);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{ rating: number; recovery: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rating) {
      setError("Choose a score from 1 to 5.");
      return;
    }
    setError(null);
    const comment = new FormData(event.currentTarget).get("comment");

    startTransition(async () => {
      const result = await submitFeedback({ token, rating, comment });
      if (result.ok) setDone({ rating: result.rating, recovery: result.recovery });
      else setError(result.message);
    });
  }

  if (done) {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">Thanks</h1>

        {/* One line, and for a low score it is a commitment rather than an
            apology: somebody is calling today. Handing a person who has just
            said the clean was poor nothing but a review button is an
            invitation to go and write that in public, and the promise is what
            buys the phone call time to land.

            Everybody still gets the same link below. Withholding it by score
            is what breaches Google's policy and the FTC's rule; saying sorry
            to the people who deserve it does not. */}
        <p className="mt-4 leading-relaxed text-muted">
          {done.recovery
            ? "Sorry that one missed. We will call you today to put it right, and if it is something we can re clean, we will come back at no charge."
            : "That helps more than you know, and your cleaner will hear about it."}
        </p>

        {/* The same link for everybody, whatever they scored. */}
        {site.reviewUrl && (
          <div className="mt-8 rounded-2xl border border-hairline bg-panel p-6">
            <p className="text-sm leading-relaxed text-body">
              If you have a moment, a public review helps other people in the area decide
              whether to trust us.
            </p>
            <a
              href={site.reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white"
            >
              Leave a review
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={send} method="post" className="max-w-md">
      <h1 className="text-3xl font-semibold text-navy md:text-4xl">How did we do?</h1>
      <p className="mt-4 leading-relaxed text-muted">
        Anything you add is read by us, not published.
      </p>

      {/* The ends are labelled rather than the scale explained. "5 being
          great" asks somebody to hold a rule in their head and then apply it;
          a word under each end is just read. */}
      <div className="mt-6 flex flex-wrap gap-2">
        {SCORES.map((n) => (
          <span key={n} className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => setRating(n)}
              aria-pressed={rating === n}
              aria-label={
                n === 1 ? "1, not great" : n === 5 ? "5, great" : String(n)
              }
              className={`h-14 w-14 rounded-full border text-lg font-semibold transition-colors ${
                rating === n
                  ? "border-accent bg-accent text-white"
                  : "border-hairline text-body hover:border-accent"
              }`}
            >
              {n}
            </button>
            <span aria-hidden className="text-xs text-muted">
              {n === 1 ? "Not great" : n === 5 ? "Great" : " "}
            </span>
          </span>
        ))}
      </div>

      <label className="mt-6 block">
        <span className="text-sm font-medium text-body">
          Anything you want to tell us, optional
        </span>
        <textarea
          name="comment"
          rows={4}
          placeholder="What went well, or what we missed."
          className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-body placeholder:text-muted/70"
        />
      </label>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={pending || !hydrated}
        className="mt-5 w-full rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
