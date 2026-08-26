"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setVisitCrew } from "@/actions/crew";

export type CleanerOption = { id: string; name: string };
export type CrewMember = { cleanerId: string; isLead: boolean };

/**
 * Who is doing this job.
 *
 * Replaces a single dropdown that could only ever hold one name. The dropdown
 * wrote to a column on the visit; the crew it is replacing writes to its own
 * table, which is the thing that can hold a second person, a lead, and a
 * different figure owed to each of them.
 *
 * Saved on a button rather than on change. A dropdown that saved as you
 * touched it was right when the whole action was picking one name. Building a
 * crew is several decisions, and firing an email to somebody the moment they
 * appear in a list is how a cleaner gets told about a job you were still
 * deciding.
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

  function toggle(cleanerId: string) {
    setNotice(null);
    setMembers((current) => {
      const already = current.some((m) => m.cleanerId === cleanerId);
      if (already) {
        const next = current.filter((m) => m.cleanerId !== cleanerId);
        // Taking the lead off leaves nobody in charge, so the next person up
        // takes it rather than the crew being saved in a state the server
        // will refuse.
        if (next.length > 0 && !next.some((m) => m.isLead)) next[0].isLead = true;
        return next;
      }
      return [...current, { cleanerId, isLead: current.length === 0 }];
    });
  }

  function makeLead(cleanerId: string) {
    setNotice(null);
    setMembers((current) =>
      current.map((m) => ({ ...m, isLead: m.cleanerId === cleanerId })),
    );
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
      <div className="flex flex-wrap items-center gap-2">
        {cleaners.map((c) => {
          const member = members.find((m) => m.cleanerId === c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              aria-pressed={Boolean(member)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                member
                  ? "border-accent bg-accent text-white"
                  : "border-hairline text-body hover:border-accent"
              }`}
            >
              {c.name}
            </button>
          );
        })}
      </div>

      {/* Only worth asking once there is somebody to choose between. On a
          house the lead takes a premium off the top, so this is a question
          about money rather than about who holds the keys. */}
      {members.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Lead</span>
          {members.map((m) => {
            const name = cleaners.find((c) => c.id === m.cleanerId)?.name ?? "";
            return (
              <button
                key={m.cleanerId}
                type="button"
                onClick={() => makeLead(m.cleanerId)}
                aria-pressed={m.isLead}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  m.isLead
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-hairline text-muted hover:text-navy"
                }`}
              >
                {name}
              </button>
            );
          })}
          {isHouse && (
            <span className="text-xs text-muted">
              takes $15 before the rest is split
            </span>
          )}
        </div>
      )}

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
