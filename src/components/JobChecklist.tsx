import type { ChecklistSection } from "@/lib/checklists";

/**
 * What this job covers, on the cleaner's phone.
 *
 * A prompt, not a record. Nothing is ticked and nothing is stored, so this
 * stays a server component and adds no weight to a page somebody opens
 * standing in a doorway on whatever signal they have.
 *
 * The count is up top because the first useful thing is knowing how big this
 * one is before scrolling into it.
 */
export function JobChecklist({ sections }: { sections: ChecklistSection[] }) {
  const total = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          What this job covers
        </h2>
        <span className="text-sm text-muted">{total} things</span>
      </div>

      <div className="mt-5 space-y-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="text-sm font-semibold text-navy">{section.title}</p>
            <ul className="mt-2 space-y-1">
              {section.items.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 py-1.5 text-sm leading-relaxed text-body"
                >
                  <span aria-hidden className="mt-px text-muted">
                    &middot;
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
