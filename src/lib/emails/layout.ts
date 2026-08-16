import { site } from "../site";

/**
 * Shared shell for transactional email.
 *
 * Tables and inline styles, not flexbox and stylesheets. Outlook renders mail
 * with Word's engine, which supports neither. The logo is a hosted PNG rather
 * than the SVG the site uses, because Gmail strips SVG entirely and the member
 * would see nothing where the brand should be.
 */

const ACCENT = "#1F5FA6";
const NAVY = "#123A66";
const BODY = "#23303D";
const MUTED = "#5A6B7C";
const HAIRLINE = "#DBE3EC";

export type Row = { label: string; value: string };

export function emailLayout(opts: {
  heading: string;
  intro: string;
  rows?: Row[];
  body?: string[];
  cta?: { label: string; url: string };
  footerNote?: string;
}): string {
  const { heading, intro, rows = [], body = [], cta, footerNote } = opts;

  const rowsHtml = rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
              style="margin:24px 0;border:1px solid ${HAIRLINE};border-radius:12px;border-collapse:separate;">
         ${rows
           .map(
             (r, i) => `
         <tr>
           <td style="padding:12px 16px;font:14px -apple-system,'Helvetica Neue',Arial,sans-serif;color:${MUTED};${
             i ? `border-top:1px solid ${HAIRLINE};` : ""
           }">${escapeHtml(r.label)}</td>
           <td align="right" style="padding:12px 16px;font:600 14px -apple-system,'Helvetica Neue',Arial,sans-serif;color:${NAVY};${
             i ? `border-top:1px solid ${HAIRLINE};` : ""
           }">${escapeHtml(r.value)}</td>
         </tr>`,
           )
           .join("")}
       </table>`
    : "";

  const bodyHtml = body
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font:15px/1.6 -apple-system,'Helvetica Neue',Arial,sans-serif;color:${BODY};">${p}</p>`,
    )
    .join("");

  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">
         <tr><td align="center" bgcolor="${ACCENT}" style="border-radius:999px;">
           <a href="${cta.url}" style="display:inline-block;padding:13px 28px;font:600 15px -apple-system,'Helvetica Neue',Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(cta.label)}</a>
         </td></tr>
       </table>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#EDF2F7;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EDF2F7;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
           style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:26px 32px 0;">
        <img src="${site.url}/brand/homewick-logo-horizontal-white.png"
             alt="${escapeHtml(site.name)}" width="188"
             style="display:block;width:188px;height:auto;border:0;">
      </td></tr>
      <tr><td style="padding:20px 32px 32px;">
        <h1 style="margin:0 0 12px;font:600 24px/1.3 -apple-system,'Helvetica Neue',Arial,sans-serif;color:${NAVY};">${escapeHtml(heading)}</h1>
        <p style="margin:0 0 16px;font:16px/1.6 -apple-system,'Helvetica Neue',Arial,sans-serif;color:${BODY};">${intro}</p>
        ${rowsHtml}
        ${bodyHtml}
        ${ctaHtml}
      </td></tr>
      <tr><td style="padding:18px 32px 26px;border-top:1px solid ${HAIRLINE};">
        ${
          footerNote
            ? `<p style="margin:0 0 10px;font:13px/1.6 -apple-system,'Helvetica Neue',Arial,sans-serif;color:${MUTED};">${footerNote}</p>`
            : ""
        }
        <p style="margin:0;font:12px/1.6 -apple-system,'Helvetica Neue',Arial,sans-serif;color:${MUTED};">
          ${escapeHtml(site.name)} · ${escapeHtml(site.serviceArea)}<br>
          This address does not receive mail. To book or change a visit, use
          <a href="${site.url}" style="color:${ACCENT};">${site.url.replace(/^https?:\/\//, "")}</a>.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** The plain-text alternative. Some clients show only this, and spam filters read it. */
export function emailText(opts: {
  heading: string;
  intro: string;
  rows?: Row[];
  body?: string[];
  cta?: { label: string; url: string };
  footerNote?: string;
}): string {
  const lines = [opts.heading, "", opts.intro, ""];

  for (const r of opts.rows ?? []) lines.push(`${r.label}: ${r.value}`);
  if (opts.rows?.length) lines.push("");

  for (const p of opts.body ?? []) lines.push(stripTags(p), "");
  if (opts.cta) lines.push(`${opts.cta.label}: ${opts.cta.url}`, "");
  if (opts.footerNote) lines.push(stripTags(opts.footerNote), "");

  lines.push(
    "---",
    `${site.name} · ${site.serviceArea}`,
    `This address does not receive mail. To book or change a visit, use ${site.url}.`,
  );
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turn a body paragraph written as HTML into plain text.
 *
 * Tags come out, then entities are decoded. The decode matters because
 * anything interpolating customer-supplied text has to escape it for the HTML
 * half, and without this the plain-text half would show the reader
 * "&lt;keep the door shut&gt;" rather than what the customer actually typed.
 *
 * Ampersand is decoded last, so an escaped "&amp;lt;" survives as the literal
 * text "&lt;" instead of collapsing into a bracket.
 */
function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
