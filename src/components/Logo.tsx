/**
 * The mark is a roof chevron above the HOMEWICK wordmark, with CLEANING in a
 * rounded pill beneath. Below ~32px the chevron alone is used — the H competes
 * with it at small sizes.
 */

export function LogoHorizontal({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="52 44 330 78"
      className={className}
      role="img"
      aria-label="Homewick Cleaning"
    >
      <path
        d="M60 82 L100 54 L140 82"
        fill="none"
        stroke="#1F5FA6"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="176"
        y="78"
        fontFamily="inherit"
        fontSize="32"
        fontWeight="500"
        letterSpacing="1.5"
        fill="#123A66"
      >
        HOMEWICK
      </text>
      <rect x="178" y="90" width="132" height="24" rx="12" fill="#1F5FA6" />
      <text
        x="244"
        y="107"
        textAnchor="middle"
        fontFamily="inherit"
        fontSize="13"
        fontWeight="500"
        letterSpacing="3"
        fill="#ffffff"
      >
        CLEANING
      </text>
    </svg>
  );
}

export function LogoStacked({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="120 40 160 136"
      className={className}
      role="img"
      aria-label="Homewick Cleaning"
    >
      <path
        d="M152 84 L200 50 L248 84"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="200"
        y="128"
        textAnchor="middle"
        fontFamily="inherit"
        fontSize="30"
        fontWeight="500"
        letterSpacing="2"
        fill="currentColor"
      >
        HOMEWICK
      </text>
      <rect
        x="128"
        y="142"
        width="144"
        height="26"
        rx="13"
        fill="currentColor"
      />
      <text
        x="200"
        y="160"
        textAnchor="middle"
        fontFamily="inherit"
        fontSize="13"
        fontWeight="500"
        letterSpacing="3"
        fill="#ffffff"
      >
        CLEANING
      </text>
    </svg>
  );
}

/** Chevron only — for favicons, avatars, and anything under ~32px. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label="Homewick">
      <rect width="200" height="200" rx="36" fill="currentColor" />
      <path
        d="M56 116 L100 66 L144 116"
        fill="none"
        stroke="#ffffff"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
