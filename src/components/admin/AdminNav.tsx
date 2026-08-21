import { queryOne } from "@/lib/db";
import { currentAdmin } from "@/lib/admin-auth";
import { AdminTabs } from "./AdminTabs";

/**
 * The spine of admin, rendered once by the layout rather than by every page.
 *
 * Each page used to render this inside its own container, and those containers
 * were four different widths. So the nav re-centred and re-wrapped on every
 * click and the whole page jumped underneath it. One container, one nav.
 *
 * Server side because it needs the database and the session. The tabs
 * themselves are a client component so they can read the current URL, which is
 * more reliable than every page remembering to declare which tab it is.
 */
export async function AdminNav() {
  // An unhappy customer waiting on a callback is the one thing in admin that
  // gets worse the longer it goes unseen, so the count rides on the nav rather
  // than waiting to be discovered on a page nobody opened.
  const pending = await queryOne<{ n: number }>(
    `select count(*)::int as n from visit_feedback
      where recovery_status in ('needed', 'in_progress')`,
  ).catch(() => null);

  const admin = await currentAdmin();

  return <AdminTabs waiting={pending?.n ?? 0} adminName={admin?.name ?? null} />;
}
