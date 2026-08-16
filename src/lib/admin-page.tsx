import { requireAdmin, isAdminConfigured } from "./admin-auth";
import { isDatabaseConfigured } from "./db";

/**
 * The checks every admin page repeats.
 *
 * The proxy already turns away anyone without credentials, but these stay as
 * a second gate: a matcher typo is an easy mistake and these pages reach
 * customer addresses and revenue.
 *
 * Nothing here names an environment variable to the visitor. Anyone can reach
 * these URLs, so the specifics go to the server log and the page says only
 * that it is unavailable.
 */
export async function guardAdminPage(): Promise<{ ok: true } | { ok: false; node: React.ReactNode }> {
  if (!isAdminConfigured()) {
    console.error("[admin] ADMIN_PASSWORD is not set.");
    return { ok: false, node: <Notice>This view is not available right now.</Notice> };
  }

  const admin = await requireAdmin();
  if (!admin) {
    return { ok: false, node: <Notice>This view is protected.</Notice> };
  }

  if (!isDatabaseConfigured()) {
    console.error("[admin] DATABASE_URL is not set.");
    return { ok: false, node: <Notice>This view is not available right now.</Notice> };
  }

  return { ok: true };
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg px-5 py-24 text-center">
      <p className="text-muted">{children}</p>
    </div>
  );
}
