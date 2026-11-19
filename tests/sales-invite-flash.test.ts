import { describe, expect, it } from "vitest";
import { newInviteToken, parseInviteFlash } from "@/lib/sales/invite";

describe("invite flash cookie", () => {
  const rep = "8f14e45f-ceea-4e6a-9b1c-2a5b8c9d0e1f";
  it("reads a rep id and token", () => {
    const { token } = newInviteToken();
    expect(parseInviteFlash(`${rep}.${token}`)).toEqual({ rep, token });
  });
  it("rejects missing, malformed or tampered values", () => {
    expect(parseInviteFlash(undefined)).toBeNull();
    expect(parseInviteFlash("")).toBeNull();
    expect(parseInviteFlash(`${rep}.short`)).toBeNull();
    expect(parseInviteFlash(`not-a-rep.${newInviteToken().token}`)).toBeNull();
    expect(parseInviteFlash(`${rep}.${newInviteToken().token}<script>`)).toBeNull();
  });
});
