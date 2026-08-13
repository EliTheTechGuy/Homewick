import Link from "next/link";
import type { ReactNode } from "react";

export function Section({
  children,
  tinted = false,
  className = "",
}: {
  children: ReactNode;
  tinted?: boolean;
  className?: string;
}) {
  return (
    <section className={`${tinted ? "bg-panel" : ""} ${className}`}>
      <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  centered = false,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  centered?: boolean;
}) {
  return (
    <div className={`${centered ? "mx-auto text-center" : ""} max-w-2xl`}>
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-3 text-3xl font-semibold leading-tight text-navy md:text-4xl">
        {title}
      </h2>
      {lead && <p className="mt-4 text-lg leading-relaxed text-muted">{lead}</p>}
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "onDark";
  className?: string;
}) {
  const styles = {
    primary: "bg-accent text-white hover:bg-accent-dark",
    secondary: "border border-accent text-accent hover:bg-accent hover:text-white",
    onDark: "bg-white text-navy hover:bg-panel",
  }[variant];

  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-full px-7 py-3.5 text-sm font-semibold transition-colors ${styles} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Card({
  children,
  highlighted = false,
  className = "",
}: {
  children: ReactNode;
  highlighted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-white p-7 ${
        highlighted
          ? "border-2 border-accent shadow-lg shadow-accent/10"
          : "border border-hairline"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
