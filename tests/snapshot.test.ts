import { describe, expect, it } from "vitest";
import { contentHash, versionSnapshot } from "@/lib/export/snapshot";
import { defaultBusinessProfile, defaultProposalConfig } from "@/lib/proposal/types";
import { est, item } from "./helpers";

describe("13. export idempotency key", () => {
  const biz = { ...defaultBusinessProfile(), companyName: "Acme" };
  it("same content → same hash regardless of key order, status, or signed logo URL", () => {
    const e = est({ items: [item("g1", "1", "10", { id: "x" })] });
    const a = contentHash(versionSnapshot(e, { ...biz, logoUrl: "https://signed/1" }, defaultProposalConfig()));
    const b = contentHash(versionSnapshot({ ...e, status: "finalized", updatedAt: "later" }, { ...biz, logoUrl: "https://signed/2" }, defaultProposalConfig()));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("material changes create a new version", () => {
    const e = est({ items: [item("g1", "1", "10", { id: "x" })] });
    const base = contentHash(versionSnapshot(e, biz, defaultProposalConfig()));
    const changedPrice = contentHash(versionSnapshot({ ...e, items: [{ ...e.items[0], unitCost: "11" }] }, biz, defaultProposalConfig()));
    const changedTemplate = contentHash(versionSnapshot(e, biz, { ...defaultProposalConfig(), template: "modern" }));
    expect(new Set([base, changedPrice, changedTemplate]).size).toBe(3);
  });
});
