import Link from "next/link";
import { LogoHorizontal } from "@/components/Logo";
import { AdminNav } from "@/components/admin/AdminNav";
import { currentAdmin } from "@/lib/admin-auth";

/**
 * Admin has no marketing chrome. It is a working screen, and it can reveal
 * entry codes, so it should not look or behave like the public site.
 *
 * The nav is rendered here, once, rather than by each page. Every page used to
 * render its own inside its own container, and those containers had drifted to
 * four different widths, from 896px to 1400px. So the nav re-centred and
 * re-wrapped on every click and the whole page appeared to jump. Rendered by
 * the layout it sits in the same place on every screen, whatever the page
 * below it does.
 *
 * It only appears once somebody is signed in, which keeps it off the sign-in
 * screen without that page having to know it exists.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await currentAdmin();

  return (
    <>
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/admin" aria-label="Homewick admin">
            <LogoHorizontal className="h-9 w-auto" />
          </Link>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Admin
          </span>
        </div>
      </header>

      {admin && (
        <div className="border-b border-hairline">
          <div className="mx-auto max-w-6xl px-5 py-3">
            <AdminNav />
          </div>
        </div>
      )}

      <main className="flex-1">{children}</main>
    </>
  );
}
