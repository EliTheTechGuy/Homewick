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
        <h1 className="text-3xl font-semibold text-navy md:text-4xl">
          {done.recovery ? "Thank you, and sorry" : "Thank you"}
        </h1>

        {done.recovery ? (
          <p className="mt-4 leading-relaxed text-muted">
            That is below the standard we hold ourselves to. We will be in touch to put
            it right, and if it is something we can re clean, we will come back at no
            charge.
          </p>
        ) : (
          <p className="mt-4 leading-relaxed text-muted">
            We are glad it went well. Your cleaner will hear about it.
          </p>
        )}

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
        Pick a score, 5 being great. Anything you add is read by us, not published.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {SCORES.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-pressed={rating === n}
            className={`h-14 w-14 rounded-full border text-lg font-semibold transition-colors ${
              rating === n
                ? "border-accent bg-accent text-white"
                : "border-hairline text-body hover:border-accent"
            }`}
          >
            {n}
          </button>
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
