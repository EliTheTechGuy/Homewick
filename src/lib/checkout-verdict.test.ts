import { describe, expect, it } from "vitest";
import { verdictFromSession } from "./checkout-verdict";

describe("verdictFromSession", () => {
  it("counts a paid session", () => {
    expect(verdictFromSession({ payment_status: "paid", status: "complete" })).toBe("paid");
  });

  it("counts a session with nothing left to charge", () => {
    // A first month at 100% off still converted, and that is the campaign working.
    expect(verdictFromSession({ payment_status: "no_payment_required" })).toBe("paid");
  });

  it("does not count an unpaid session", () => {
    expect(verdictFromSession({ payment_status: "unpaid", status: "open" })).toBe("unpaid");
    expect(verdictFromSession({ payment_status: "unpaid", status: "expired" })).toBe("unpaid");
  });

  /**
   * The distinction the whole page rests on. Not knowing is not the same as
   * knowing they did not pay, and the two lead to different pages.
   */
  it("says unknown rather than guessing when there is no session", () => {
    expect(verdictFromSession(null)).toBe("unknown");
  });

  it("says unknown for a status it does not recognise", () => {
    expect(verdictFromSession({ payment_status: "something_new" })).toBe("unknown");
    expect(verdictFromSession({})).toBe("unknown");
    expect(verdictFromSession({ payment_status: null })).toBe("unknown");
  });
});
