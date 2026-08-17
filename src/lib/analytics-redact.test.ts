import { describe, expect, it } from "vitest";
import { redactAnalyticsUrl, SECRET_PATHS } from "./analytics-redact";

const SITE = "https://www.homewickcleaning.net";

describe("redactAnalyticsUrl", () => {
  it("leaves ordinary pages alone, so they still get counted", () => {
    for (const path of ["/", "/pricing", "/book", "/membership", "/privacy"]) {
      expect(redactAnalyticsUrl(`${SITE}${path}`)).toBe(`${SITE}${path}`);
    }
  });

  it("keeps the query string on ordinary pages, which is where campaign tags live", () => {
    expect(redactAnalyticsUrl(`${SITE}/book?utm_source=google`)).toBe(
      `${SITE}/book?utm_source=google`,
    );
  });

  it("removes a feedback token", () => {
    const out = redactAnalyticsUrl(`${SITE}/feedback/BQ4Xk9_r-tokenvalue`);
    expect(out).toBe(`${SITE}/feedback/redacted`);
    expect(out).not.toContain("tokenvalue");
  });

  it("removes both the customer id and the token from an unsubscribe link", () => {
    const out = redactAnalyticsUrl(
      `${SITE}/unsubscribe/8f14e45f-ceea-467a-9575-4c4a1f2a1b33/BQ4Xk9_r-tokenvalue`,
    );
    expect(out).toBe(`${SITE}/unsubscribe/redacted`);
    expect(out).not.toContain("8f14e45f");
    expect(out).not.toContain("tokenvalue");
  });

  it("removes a sign-in token from the query string", () => {
    const out = redactAnalyticsUrl(`${SITE}/account/verify?token=tokenvalue`);
    expect(out).toBe(`${SITE}/account/verify/redacted`);
    expect(out).not.toContain("tokenvalue");
  });

  it("removes a token hidden in the fragment", () => {
    const out = redactAnalyticsUrl(`${SITE}/feedback/abc#tokenvalue`);
    expect(out).not.toContain("tokenvalue");
  });

  it("sends nothing at all rather than guessing, when the url will not parse", () => {
    expect(redactAnalyticsUrl("not a url")).toBeNull();
    expect(redactAnalyticsUrl("")).toBeNull();
  });

  /**
   * The list is the whole defence, so it is worth asserting rather than
   * trusting. A route added to the app without being added here would ship
   * tokens silently.
   */
  it("covers every route that carries a credential", () => {
    expect(SECRET_PATHS).toEqual(["/feedback/", "/unsubscribe/", "/account/verify"]);
  });
});
