import { site } from "./site";

/**
 * Outbound email.
 *
 * Resend when configured; otherwise the message is written to the server log
 * so a deployment without a mail provider degrades to something an operator
 * can still act on, rather than failing silently or blocking sign-in.
 */

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  /** Optional; clients that cannot render it fall back to `text`. */
  html?: string;
}): Promise<{ delivered: boolean }> {
  if (!isEmailConfigured()) {
    console.warn(
      `[email] RESEND_API_KEY/EMAIL_FROM not set, not sending.\n` +
        `  to: ${params.to}\n  subject: ${params.subject}\n${params.text}`,
    );
    return { delivered: false };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        ...(params.html ? { html: params.html } : {}),
        // No reply-to header on purpose. This address does not take mail, and
        // the message says so. Pointing replies somewhere they are not read
        // would be worse than telling people plainly not to reply.
      }),
    });

    if (!response.ok) {
      console.error("[email] Resend rejected the message", response.status, await response.text());
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[email] send failed", err);
    return { delivered: false };
  }
}

export function signInEmail(url: string): { subject: string; text: string } {
  return {
    subject: `Your ${site.name} sign-in link`,
    text: [
      `Tap the link below to open your ${site.name} account.`,
      "",
      url,
      "",
      "It works once and expires in 15 minutes.",
      "If you did not ask for this, you can ignore it. Nothing has changed.",
      "",
      "---",
      "This address does not receive mail, so please do not reply.",
      `To book, change a visit, or ask us anything, use ${site.url}.`,
    ].join("\n"),
  };
}
