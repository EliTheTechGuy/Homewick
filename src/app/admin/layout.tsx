import Link from "next/link";
import { LogoHorizontal } from "@/components/Logo";

/**
 * Admin has no marketing chrome. It is a working screen, and it can reveal
 * entry codes, so it should not look or behave like the public site.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Link href="/admin" aria-label="Homewick admin">
            <LogoHorizontal className="h-9 w-auto" />
          </Link>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Admin
          </span>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </>
  );
}
