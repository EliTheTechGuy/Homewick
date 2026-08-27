"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setVisitCrew } from "@/actions/crew";

export type CleanerOption = { id: string; name: string };
export type CrewMember = { cleanerId: string; isLead: boolean };

/**
 * Who is doing this job.
 *
 * A row of buttons, one per cleaner, was fine at three and unreadable at
 * thirty: the roster is the part that grows, and the crew is the part that
 * stays small. So the roster went into a select and the crew stayed as chips.
 * You read who is on it at a glance and go looking only when adding somebody.
 *
 * Saved on a button rather than on change. Building a crew is several
 * decisions, and emailing somebody the moment they appear in a list tells a
 * cleaner about a job still being decided.
 */
export function AssignCrew({
  visitId,
  cleaners,
  crew,
  isHouse,
}: {
  visitId: string;
  cleaners: CleanerOption[];
  crew: CrewMember[];
  /** Houses split the job across the crew; apartments pay each their own rate. */
  isHouse: boolean;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<CrewMember[]>(crew);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const nameOf = (id: string) => cleaners.find((c) => c.id === id)?.name ?? "Unknown";
  const available = cleaners.filter((c) => !members.some((m) => m.cleanerId === c.id));

  const dirty =
    members.length !== crew.length ||
    members.some((m) => {
      const was = crew.find((c) => c.cleanerId === m.cleanerId);
      return !was || was.isLead !== m.isLead;
    });

  if (cleaners.length === 0) {
    return (
      <p className="text-sm text-muted">
        No cleaners on the roster yet.{" "}
        <a href="/admin/cleaners" className="text-accent underline">
          Add one
        </a>{" "}
        and you can put them on this.
      </p>
    );
  }

  function add(cleanerId: string) {
    if (!cleanerId) return;
    setNotice(null);
    setMembers((current) => [
      ...current,
      { cleanerId, isLead: current.length === 0 },
    ]);
  }

  function remove(cleanerId: string) {
    setNotice(null);
    setMembers((current) => {
      const next = current.filter((m) => m.cleanerId !== cleanerId);
      // Taking the lead off leaves nobody in charge, so the next person up
      // takes it rather than the crew being saved in a state the server will
      // refuse.
      if (next.length > 0 && !next.some((m) => m.isLead)) next[0].isLead = true;
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setVisitCrew({ visitId, members });
      setFailed(!result.ok);
      setNotice(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div>
      {members.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {members.map((m) => (
            <li
              key={m.cleanerId}
              className="flex items-center gap-2 rounded-full border border-accent bg-accent/5 py-1 pl-3 pr-1 text-sm"
            >
              <span className="font-medium text-navy">{nameOf(m.cleanerId)}</span>
              {members.length > 1 && m.isLead && (
                <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                  Lead
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(m.cleanerId)}
                aria-label={`Take ${nameOf(m.cleanerId)} off this job`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-white hover:text-red-700"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {available.length > 0 ? (
          <label className="text-sm">
            <span className="sr-only">Add a cleaner</span>
            <select
              value=""
              onChange={(e) => add(e.target.value)}
              className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm text-body"
            >
              <option value="">
                {members.length === 0 ? "Put somebody on this…" : "Add another…"}
              </option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-sm text-muted">Everybody is on this one.</span>
        )}

        {/* Only worth asking once there is somebody to choose between. On a
            house the lead takes a premium off the top, so this is a question
            about money rather than about who holds the keys. */}
        {members.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Lead</span>
            <select
              value={members.find((m) => m.isLead)?.cleanerId ?? ""}
              onChange={(e) =>
                setMembers((current) =>
                  current.map((m) => ({ ...m, isLead: m.cleanerId === e.target.value })),
                )
              }
              className="rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-body"
            >
              {members.map((m) => (
                <option key={m.cleanerId} value={m.cleanerId}>
                  {nameOf(m.cleanerId)}
                </option>
              ))}
            </select>
            {isHouse && (
              <span className="text-xs text-muted">takes $15 before the split</span>
            )}
          </label>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-40"
        >
          {pending ? "Saving…" : members.length === 0 ? "Clear the crew" : "Save crew"}
        </button>
        {dirty && !pending && (
          <span className="text-xs text-muted">
            Newly added people are emailed the job when you save.
          </span>
        )}
        {notice && (
          <span
            role={failed ? "alert" : "status"}
            className={`text-sm ${failed ? "text-red-700" : "text-muted"}`}
          >
            {notice}
          </span>
        )}
      </div>
    </div>
  );
}
