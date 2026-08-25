"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFreeAddOnOverride } from "@/actions/free-add-on-override";

/**
 * Whether this customer gets the free monthly add-on.
 *
 * Three states, not two. "Their plan decides" is the resting state and is what
 * every ordinary membership should sit on, so that changing a tier's rules
 * still reaches them. The other two are decisions about this person, which is
 * the only way a promise made on the phone gets into the system.
 *
 * The resolved answer is shown next to the choice rather than left to be
 * inferred, because "their plan decides" means nothing on its own when the
 * whole reason you are looking is that you cannot remember what their plan is.
 */
export function FreeAddOnToggle({
  subscriptionId,
  override,
  effective,
}: {
  subscriptionId: string;
  override: boolean | null;
  /** What the answer works out to right now, override applied. */
  effective: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function set(included: boolean | null) {
    startTransition(async () => {
      const result = await setFreeAddOnOverride({ subscriptionId, included });
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  const options: { label: string; value: boolean | null }[] = [
    { label: "Their plan decides", value: null },
    { label: "Give it", value: true },
    { label: "Do not", value: false },
  ];

  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs uppercase tracking-widest text-muted">
          Free add-on
        </span>
        <span className="inline-flex overflow-hidden rounded-full border border-hairline">
          {options.map((o) => {
            const active = override === o.value;
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => set(o.value)}
                disabled={pending || active}
                aria-pressed={active}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-accent text-white"
                    : "text-muted hover:text-navy disabled:opacity-50"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </span>
        <span className="text-xs text-muted">
          {effective ? "Currently getting one each period" : "Currently not getting one"}
        </span>
      </div>
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={`mt-2 text-xs ${failed ? "text-red-700" : "text-muted"}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
