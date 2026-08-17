import type { Metadata } from "next";
import { query } from "@/lib/db";
import { guardAdminPage } from "@/lib/admin-page";
import { isDatabaseConfigured } from "@/lib/db";
import { CleanerRoster } from "@/components/admin/CleanerRoster";
import { AdminNav } from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cleaners",
  robots: { index: false, follow: false },
};

export type CleanerRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  is_active: boolean;
  hired_on: string | null;
  upcoming: number;
  completed: number;
};

export default async function CleanersPage() {
  const guard = await guardAdminPage();
  if (!guard.ok) return guard.node;

  // Counts come back with the roster so the page can say who is actually
  // carrying work, rather than just who exists.
  const cleaners = await query<CleanerRow>(
    `select cl.id, cl.first_name, cl.last_name, cl.phone, cl.email::text as email,
            cl.is_active, cl.hired_on::text as hired_on,
            (select count(*) from visits v
              where v.assigned_cleaner_id = cl.id
                and v.status in ('scheduled', 'assigned')
                and v.scheduled_for >= now())::int as upcoming,
            (select count(*) from visits v
              where v.assigned_cleaner_id = cl.id and v.status = 'completed')::int as completed
       from cleaners cl
      order by cl.is_active desc, cl.first_name, cl.last_name`,
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <AdminNav current="cleaners" />
      <h1 className="mt-6 text-3xl font-semibold text-navy">Cleaners</h1>
      <p className="mt-2 max-w-2xl leading-relaxed text-muted">
        Everyone who can be put on a job. Assigning somebody emails them the
        details straight away, so the email address here has to be one they
        actually read.
      </p>
      <CleanerRoster cleaners={cleaners} />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg px-5 py-24 text-center">
      <p className="text-muted">{children}</p>
    </div>
  );
}
