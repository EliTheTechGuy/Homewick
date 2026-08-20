"use client";

import Link from "next/link";
import { useState } from "react";
import { LogoHorizontal } from "./Logo";

/**
 * Services has children now that houses are priced differently from
 * apartments. Everything else stays flat.
 *
 * The dropdown opens on hover for a mouse and on focus for a keyboard, and the
 * parent is itself a link to the overview page, so it is never a trap for
 * somebody who cannot hover. On mobile the children are simply indented under
 * it, because a hover menu on a touchscreen is nobody's friend.
 */
const links: { href: string; label: string; children?: { href: string; label: string }[] }[] = [
  {
    href: "/services",
    label: "Services",
    children: [
      { href: "/services/apartments", label: "Apartments" },
      { href: "/services/residential", label: "Houses" },
    ],
  },
  { href: "/membership", label: "Membership" },
  { href: "/pricing", label: "Pricing" },
  { href: "/account", label: "My account" },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-3">
        <Link href="/" className="shrink-0" aria-label="Homewick Cleaning, home">
          <LogoHorizontal className="h-11 w-auto" />
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) =>
            l.children ? (
              <div key={l.href} className="group relative">
                <Link
                  href={l.href}
                  className="flex items-center gap-1 py-2 text-sm font-medium text-body transition-colors hover:text-accent"
                >
                  {l.label}
                  <svg viewBox="0 0 12 8" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 1l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
                <div className="invisible absolute left-0 top-full z-50 min-w-44 rounded-xl border border-hairline bg-white p-1.5 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  {l.children.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      className="block rounded-lg px-3 py-2 text-sm font-medium text-body transition-colors hover:bg-panel hover:text-accent"
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm font-medium text-body transition-colors hover:text-accent"
              >
                {l.label}
              </Link>
            ),
          )}
          <Link
            href="/book"
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
          >
            Book Online
          </Link>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle menu"
          className="rounded-md p-2 text-navy md:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <nav className="border-t border-hairline bg-white px-5 py-3 md:hidden">
          {links.map((l) => (
            <div key={l.href}>
              <Link
                href={l.href}
                onClick={() => setOpen(false)}
                className="block py-2.5 text-sm font-medium text-body"
              >
                {l.label}
              </Link>
              {l.children?.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  onClick={() => setOpen(false)}
                  className="block py-2 pl-4 text-sm text-muted"
                >
                  {c.label}
                </Link>
              ))}
            </div>
          ))}
          <Link
            href="/book"
            onClick={() => setOpen(false)}
            className="mt-2 block rounded-full bg-accent px-5 py-3 text-center text-sm font-semibold text-white"
          >
            Book Online
          </Link>
        </nav>
      )}
    </header>
  );
}
