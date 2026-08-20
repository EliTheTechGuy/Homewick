"use client";

import { useState, useTransition } from "react";
import { setEnquiryStatus } from "@/actions/enquiry-admin";

const OPTIONS = ["new", "quoted", "won", "lost"] as const;

/** Where a lead has got to. Changing it is the only action this page needs. */
export function EnquiryStatus({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        startTransition(async () => {
          const res = await setEnquiryStatus(id, next);
          if (!res.ok) setValue(status);
        });
      }}
      className="mt-1 rounded-full border border-hairline bg-white px-3 py-1 text-xs font-medium text-body"
      aria-label="Request status"
    >
      {OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
