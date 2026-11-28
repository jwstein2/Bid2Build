import { describe, expect, it } from "vitest";
import { signedInLabel } from "@/lib/signed-in";

describe("signedInLabel", () => {
  it("prefers the Enterprise company name", () => expect(signedInLabel("Acme Co", "Testificate")).toBe("Acme Co"));
  it("falls back to the Company profile name", () => expect(signedInLabel(null, "  Testificate  ")).toBe("Testificate"));
  it("is null when neither is set", () => expect(signedInLabel("  ", null)).toBeNull());
});
