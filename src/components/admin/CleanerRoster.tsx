"use client";

import { useState, useTransition } from "react";
import { addCleaner, setCleanerActive } from "@/actions/cleaners";
import type { CleanerRow } from "@/app/admin/cleaners/page";

const inputClass =
  "mt-1.5 w-full rounded-xl border border-hairline bg-white px-4 py-2.5 text-body";

export function CleanerRoster({ cleaners }: { cleaners: CleanerRow[] }) {
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const active = cleaners.filter((c) => c.is_active);
  const inactive = cleaners.filter((c) => !c.is_active);

  function submit(form: FormData) {
    setNotice(null);
    startTransition(async () => {
      const result = await addCleaner(form);
      setNotice(result);
      if (result.ok) setAdding(false);
    });
  }

  function toggle(id: string, next: boolean) {
    setNotice(null);
    startTransition(async () => setNotice(await setCleanerActive(id, next)));
  }

  return (
    <div className="mt-8">
      {notice && (
        <p
          role="status"
          className={`mb-4 rounded-xl px-4 py-3 text-sm ${
            notice.ok ? "bg-panel text-body" : "bg-red-50 text-red-800"
          }`}
        >
          {notice.message}
        </p>
      )}

      {adding ? (
        <form action={submit} className="rounded-2xl border border-hairline bg-panel p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-body">First name</span>
              <input name="firstName" required className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-body">Last name</span>
              <input name="lastName" required className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-body">Phone</span>
              <input name="phone" required inputMode="tel" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-body">Email</span>
              <input name="email" required type="email" className={inputClass} />
              <span className="mt-1 block text-xs text-muted">
                Where their jobs get sent. They do not need an account.
              </span>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
            >
              {pending ? "Saving…" : "Add to roster"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-full border border-hairline px-5 py-2 text-sm font-semibold text-body"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
        >
          Add a cleaner
        </button>
      )}

      {cleaners.length === 0 && !adding && (
        <p className="mt-8 text-muted">
          Nobody on the roster yet. Add someone and they can be put on jobs.
        </p>
      )}

      <List title="On the roster" rows={active} onToggle={toggle} pending={pending} />
      {inactive.length > 0 && (
        <List title="No longer active" rows={inactive} onToggle={toggle} pending={pending} />
      )}
    </div>
  );
}

function List({
  title,
  rows,
  onToggle,
  pending,
}: {
  title: string;
  rows: CleanerRow[];
  onToggle: (id: string, next: boolean) => void;
  pending: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h2>
      <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div>
              <p className="font-medium text-body">
                {c.first_name} {c.last_name}
              </p>
              <p className="text-sm text-muted">
                <a href={`tel:${c.phone}`} className="text-accent underline">
                  {c.phone}
                </a>
                {c.email && <> · {c.email}</>}
              </p>
              <p className="mt-1 text-sm text-muted">
                {c.upcoming} upcoming · {c.completed} completed
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => onToggle(c.id, !c.is_active)}
              className="rounded-full border border-hairline px-4 py-2 text-sm font-semibold text-body disabled:opacity-50"
            >
              {c.is_active ? "Take off roster" : "Put back on"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
