"use client";

import { useState } from "react";
import type { ChecklistSection } from "@/lib/checklists";

/**
 * The list of what this job covers, on the cleaner's phone.
 *
 * Two modes while the choice is being made. Read-only is a prompt so nothing
 * is forgotten. Tickable is the same list plus a record of what was actually
 * done, which is the thing worth having when a low rating arrives and
 * somebody has to work out whether it was a skipped step or a standards
 * problem before picking up the phone.
 *
 * State is local here. Persisting it is what the real tickable build adds,
 * and it is deliberately not in this preview: the decision being made is
 * about the shape on the screen, not the plumbing behind it.
 */
export function JobChecklist({
  sections,
  tickable,
}: {
  sections: ChecklistSection[];
  tickable: boolean;
}) {
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const [done, setDone] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setDone((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          What this job covers
        </h2>
        <span
          className={`text-sm font-medium ${
            tickable && done.size === total ? "text-accent" : "text-muted"
          }`}
        >
          {tickable ? `${done.size} of ${total} done` : `${total} things`}
        </span>
      </div>

      {tickable && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-hairline">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${total ? (done.size / total) * 100 : 0}%` }}
          />
        </div>
      )}

      <div className="mt-5 space-y-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="text-sm font-semibold text-navy">{section.title}</p>
            <ul className="mt-2 space-y-1">
              {section.items.map((item) => {
                const key = `${section.title}:${item}`;
                const ticked = done.has(key);

                if (!tickable) {
                  return (
                    <li
                      key={key}
                      className="flex gap-3 py-1.5 text-sm leading-relaxed text-body"
                    >
                      <span aria-hidden className="text-muted">
                        &middot;
                      </span>
                      <span>{item}</span>
                    </li>
                  );
                }

                return (
                  <li key={key}>
                    {/* A whole-row target. Somebody is doing this one-handed,
                        standing up, holding something else. */}
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg py-2 pr-2 text-sm leading-relaxed">
                      <input
                        type="checkbox"
                        checked={ticked}
                        onChange={() => toggle(key)}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-[#1F5FA6]"
                      />
                      <span className={ticked ? "text-muted line-through" : "text-body"}>
                        {item}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
