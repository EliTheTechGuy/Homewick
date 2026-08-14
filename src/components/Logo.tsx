/**
 * The Homewick lockups, reproduced exactly from the supplied brand artwork
 * (homewick-logo-horizontal-white.svg, homewick-logo-stacked-white.svg,
 * homewick-icon-white.svg — kept in public/brand for print and hand-off).
 *
 * Geometry, type sizes, weights, and letter-spacing match those files
 * character for character. Do not "improve" the spacing here: an earlier
 * version added tracking to HOMEWICK and enlarged CLEANING, and the result no
 * longer matched the printed business cards.
 *
 * The only deliberate differences from the source files are that the white
 * background rectangle is dropped, so the mark sits on any surface, and the
 * viewBox is cropped to the artwork so it does not float in dead space.
 */

const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const ACCENT = "#1F5FA6";
const NAVY = "#123A66";

/** Wide lockup: chevron left, wordmark right. For the site header. */
export function LogoHorizontal({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="52 46 340 74"
      className={className}
      role="img"
      aria-label="Homewick Cleaning"
    >
      <path
        d="M60 82 L100 54 L140 82"
        fill="none"
        stroke={ACCENT}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="176" y="78" fontFamily={FONT} fontSize="32" fontWeight="500" fill={NAVY}>
        HOMEWICK
      </text>
      <rect x="178" y="90" width="132" height="24" rx="12" fill={ACCENT} />
      <text
        x="244"
        y="106"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="10"
        letterSpacing="4"
        fill="#FFFFFF"
      >
        CLEANING
      </text>
    </svg>
  );
}

/**
 * Stacked lockup: chevron over wordmark over pill.
 *
 * `reversed` flips it for dark surfaces — the navy wordmark is invisible on
 * the navy footer, so it goes white and the pill inverts with it.
 */
export function LogoStacked({
  className = "",
  reversed = false,
}: {
  className?: string;
  reversed?: boolean;
}) {
  const mark = reversed ? "#FFFFFF" : ACCENT;
  const word = reversed ? "#FFFFFF" : NAVY;
  const pillFill = reversed ? "#FFFFFF" : ACCENT;
  const pillText = reversed ? NAVY : "#FFFFFF";

  return (
    <svg
      viewBox="108 42 184 132"
      className={className}
      role="img"
      aria-label="Homewick Cleaning"
    >
      <path
        d="M152 84 L200 50 L248 84"
        fill="none"
        stroke={mark}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="200"
        y="128"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="30"
        fontWeight="500"
        fill={word}
      >
        HOMEWICK
      </text>
      <rect x="128" y="142" width="144" height="26" rx="13" fill={pillFill} />
      <text
        x="200"
        y="159"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="11"
        letterSpacing="4"
        fill={pillText}
      >
        CLEANING
      </text>
    </svg>
  );
}

/**
 * Chevron only, in a rounded tile. Used below roughly 32px — the H competes
 * with the chevron at small sizes, so the wordmark is dropped rather than
 * shrunk into mush.
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label="Homewick">
      <rect width="200" height="200" rx="36" fill={ACCENT} />
      <path
        d="M56 116 L100 66 L144 116"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
