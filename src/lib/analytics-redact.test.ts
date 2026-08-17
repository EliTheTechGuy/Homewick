import { describe, expect, it } from "vitest";
import { redactAnalyticsUrl, KEPT_PARAMS, SECRET_PATHS } from "./analytics-redact";

const SITE = "https://www.homewickcleaning.net";

describe("redactAnalyticsUrl", () => {
  it("leaves ordinary pages alone, so they still get counted", () => {
    for (const path of ["/", "/pricing", "/book", "/membership", "/privacy"]) {
      expect(redactAnalyticsUrl(`${SITE}${path}`)).toBe(`${SITE}${path}`);
    }
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

  describe("query parameters", () => {
    it("keeps campaign tags, which is the whole point of measuring", () => {
      const out = redactAnalyticsUrl(
        `${SITE}/book?utm_source=google&utm_campaign=spring&gclid=abc123`,
      );
      expect(out).toContain("utm_source=google");
      expect(out).toContain("utm_campaign=spring");
      expect(out).toContain("gclid=abc123");
    });

    it("drops the booking id and stripe session from the paid confirmation", () => {
      const out = redactAnalyticsUrl(
        `${SITE}/book/confirmed/paid?ref=8f14e45f-ceea-467a-9575-4c4a1f2a1b33&session_id=cs_test_a1b2c3`,
      );
      expect(out).toBe(`${SITE}/book/confirmed/paid`);
      expect(out).not.toContain("8f14e45f");
      expect(out).not.toContain("cs_test");
    });

    it("still counts the paid confirmation as its own page, which is what ads match on", () => {
      expect(
        redactAnalyticsUrl(`${SITE}/book/confirmed/paid?ref=abc&session_id=cs_1`),
      ).toContain("/book/confirmed/paid");
    });

    it("keeps a campaign tag while dropping an identifier in the same url", () => {
      const out = redactAnalyticsUrl(
        `${SITE}/book/confirmed?ref=8f14e45f&utm_source=google`,
      );
      expect(out).toContain("utm_source=google");
      expect(out).not.toContain("8f14e45f");
    });

    it("drops anything it does not recognise, rather than passing it through", () => {
      const out = redactAnalyticsUrl(`${SITE}/book?email=someone%40example.com&phone=5551234`);
      expect(out).toBe(`${SITE}/book`);
      expect(out).not.toContain("example.com");
      expect(out).not.toContain("5551234");
    });
  });

  /**
   * Both lists are the whole defence, so they are worth asserting rather than
   * trusting. A route added to the app without being added here would ship
   * tokens silently, and a parameter added to the keep list is a decision that
   * should be deliberate rather than incidental.
   */
  it("covers every route that carries a credential", () => {
    expect(SECRET_PATHS).toEqual(["/feedback/", "/unsubscribe/", "/account/verify"]);
  });

  it("keeps only campaign attribution parameters", () => {
    expect(KEPT_PARAMS).toEqual([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "gbraid",
      "wbraid",
      "msclkid",
      "fbclid",
      "canceled",
    ]);
  });
});
