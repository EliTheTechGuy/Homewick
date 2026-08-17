import { ImageResponse } from "next/og";

/**
 * The card that appears when somebody shares a link.
 *
 * Without one, every share renders as a blank rectangle with a URL under it,
 * which reads as a broken or untrustworthy link. That matters most in exactly
 * the place this business grows: somebody texting the site to a neighbour.
 *
 * Drawn rather than a static file so it stays in step with the brand marks,
 * and so there is no image to forget to update.
 */
// Node rather than edge: Next 16 deprecates the edge runtime, and this is
// generated once and cached, so there is nothing to gain from the edge.
export const runtime = "nodejs";
export const alt = "Homewick Cleaning, apartment cleaning in Dallas-Fort Worth";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#123A66",
          padding: "72px 80px",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* The roofline from the logo, drawn as a stroke. */}
          <svg width="88" height="52" viewBox="0 0 88 52">
            <path
              d="M6 44 L44 8 L82 44"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#FFFFFF", fontSize: 40, fontWeight: 600, letterSpacing: 1 }}>
              HOMEWICK
            </span>
            <span
              style={{
                color: "#9CC2E8",
                fontSize: 16,
                letterSpacing: 8,
                marginTop: 4,
              }}
            >
              CLEANING
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: "#FFFFFF", fontSize: 68, fontWeight: 600, lineHeight: 1.1 }}>
            Two cleanings a month.
          </span>
          <span style={{ color: "#FFFFFF", fontSize: 68, fontWeight: 600, lineHeight: 1.1 }}>
            One flat charge.
          </span>
          <span style={{ color: "#9CC2E8", fontSize: 30, marginTop: 28 }}>
            Apartment cleaning across Dallas-Fort Worth
          </span>
        </div>
      </div>
    ),
    size,
  );
}
