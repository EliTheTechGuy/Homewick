import Link from "next/link";
import { LogoStacked } from "./Logo";
import { site } from "@/lib/site";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 bg-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[auto_1fr_1fr]">
        <div>
          <LogoStacked className="h-24 w-auto text-white" />
        </div>

        <div>
          <h2 className="text-sm font-semibold tracking-wide text-white/90">Service area</h2>
          <p className="mt-3 text-sm text-white/70">{site.serviceArea}</p>
          {site.email && (
            <p className="mt-4 text-sm text-white/70">
              <a href={`mailto:${site.email}`} className="hover:text-white">
                {site.email}
              </a>
            </p>
          )}
          {site.phone && <p className="mt-1 text-sm text-white/70">{site.phone}</p>}
        </div>

        <div>
          <h2 className="text-sm font-semibold tracking-wide text-white/90">Company</h2>
          <ul className="mt-3 space-y-2 text-sm text-white/70">
            <li>
              <Link href="/services" className="hover:text-white">
                Services
              </Link>
            </li>
            <li>
              <Link href="/membership" className="hover:text-white">
                Membership
              </Link>
            </li>
            <li>
              <Link href="/pricing" className="hover:text-white">
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-white">
                Service agreement
              </Link>
            </li>
            <li>
              <Link href="/book" className="hover:text-white">
                Book online
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/15">
        <div className="mx-auto max-w-6xl px-5 py-5 text-xs text-white/55">
          © {year} {site.name}. A {site.legalEntity} company. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
