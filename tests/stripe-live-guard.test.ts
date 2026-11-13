import { afterEach, describe, expect, it } from "vitest";
import { assertModeAllowed } from "@/lib/billing/stripe";

const saved = { key: process.env.STRIPE_SECRET_KEY, allow: process.env.STRIPE_ALLOW_LIVE };
afterEach(() => {
  process.env.STRIPE_SECRET_KEY = saved.key;
  process.env.STRIPE_ALLOW_LIVE = saved.allow;
  if (saved.key === undefined) delete process.env.STRIPE_SECRET_KEY;
  if (saved.allow === undefined) delete process.env.STRIPE_ALLOW_LIVE;
});

describe("live-mode guard", () => {
  for (const prefix of ["sk_live_", "rk_live_"]) {
    it(`blocks ${prefix} keys unless STRIPE_ALLOW_LIVE=true`, () => {
      process.env.STRIPE_SECRET_KEY = `${prefix}dummy`;
      delete process.env.STRIPE_ALLOW_LIVE;
      expect(() => assertModeAllowed()).toThrow(/STRIPE_ALLOW_LIVE/);
      process.env.STRIPE_ALLOW_LIVE = "false";
      expect(() => assertModeAllowed()).toThrow();
      process.env.STRIPE_ALLOW_LIVE = "true";
      expect(() => assertModeAllowed()).not.toThrow();
    });
  }
  it("allows test keys without the flag", () => {
    delete process.env.STRIPE_ALLOW_LIVE;
    for (const k of ["sk_test_dummy", "rk_test_dummy"]) {
      process.env.STRIPE_SECRET_KEY = k;
      expect(() => assertModeAllowed()).not.toThrow();
    }
  });
});
