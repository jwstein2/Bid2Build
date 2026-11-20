import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_UPDATED } from "@/components/legal/legal-page";
import {
  LEGAL_DOCUMENTS, PRIMARY_STATUS_LINE, PUBLIC_STATUS, REVIEW_DISCLOSURE, SHORT_DISCLOSURE, effectiveStatus, legalDate, statusCounts,
} from "@/lib/legal/registry";
import { disclosureFor } from "@/components/legal/legal-status";

const read = (p: string) => readFileSync(p, "utf8");

describe("legal document registry", () => {
  it("has unique keys and every document defaults to published, review pending", () => {
    const keys = LEGAL_DOCUMENTS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of LEGAL_DOCUMENTS) expect(d.defaultStatus).toBe("published_pending");
  });

  it("never marks anything reviewed by default and needs a recorded status to show reviewed", () => {
    const d = LEGAL_DOCUMENTS[0];
    expect(effectiveStatus(d, null)).toEqual({ status: "published_pending", reviewCompletedOn: null });
    expect(effectiveStatus(d, { status: "bogus" as never })).toEqual({ status: "published_pending", reviewCompletedOn: null });
    expect(effectiveStatus(d, { status: "in_review", reviewCompletedOn: "2026-12-01" })).toEqual({ status: "in_review", reviewCompletedOn: null });
    expect(effectiveStatus(d, { status: "reviewed", reviewCompletedOn: "2026-12-01" })).toEqual({ status: "reviewed", reviewCompletedOn: "2026-12-01" });
  });

  it("shows revision-required to the public as review pending (internal finding)", () => {
    expect(PUBLIC_STATUS.revision_required).toEqual(PUBLIC_STATUS.published_pending);
    expect(disclosureFor({ status: "revision_required", reviewCompletedOn: null })).toEqual([...REVIEW_DISCLOSURE]);
  });

  it("uses the owner-approved wording verbatim", () => {
    expect(PRIMARY_STATUS_LINE).toBe("Current Published Version — Legal Review Pending");
    expect(SHORT_DISCLOSURE).toBe("Current published policy. Independent legal review pending. Updates will be communicated as required.");
    expect(REVIEW_DISCLOSURE[0]).toBe("This document represents the current published version of Built2Bid LLC's applicable policies, terms, or disclosures and is pending review by independent legal counsel.");
    expect(REVIEW_DISCLOSURE).toHaveLength(3);
  });

  it("avoids prohibited status terms in customer-facing wording", () => {
    const publicText = [PRIMARY_STATUS_LINE, SHORT_DISCLOSURE, ...REVIEW_DISCLOSURE, ...Object.values(PUBLIC_STATUS).flatMap((s) => [s.title, s.subtitle]),
      ...LEGAL_DOCUMENTS.flatMap((d) => [d.name, d.version, d.location ?? "", ...d.history.map((h) => h.summary)])].join(" ");
    for (const bad of [/\bdraft\b/i, /nonbinding/i, /not yet effective/i, /unenforceable/i, /certified/i, /attorney[- ]verified/i, /legally approved/i]) expect(publicText).not.toMatch(bad);
  });

  it("keeps the documents' own dates (the notice doesn't reset them)", () => {
    expect(LEGAL_UPDATED).toBe("November 19, 2026");
    expect(read("src/app/(marketing)/security/page.tsx")).toContain('const LAST_UPDATED = "November 18, 2026"');
    for (const d of LEGAL_DOCUMENTS.filter((x) => x.category !== "in_product")) expect(d.effectiveDate).toBeNull();
  });

  it("wires every public legal page to its registry entry", () => {
    for (const d of LEGAL_DOCUMENTS.filter((x) => x.public && x.category !== "in_product")) {
      const src = read(`src/app/(marketing)${d.href}/page.tsx`);
      expect(src.includes(`docKey="${d.key}"`) || src.includes(`getLegalStatus("${d.key}")`)).toBe(true);
    }
  });

  it("links Legal Document Status from the footer", () => {
    expect(read("src/components/layout/footer.tsx")).toContain('href="/legal"');
  });

  it("keeps the sign-in agreement wording", () => {
    const src = read("src/components/auth/auth-dialog.tsx");
    expect(src).toContain("By continuing you agree to the <Link href=\"/terms\"");
    expect(src).toContain("<LegalStatusCompact center />");
  });

  it("counts and formats", () => {
    expect(statusCounts(["published_pending", "published_pending", "reviewed"])).toMatchObject({ published_pending: 2, reviewed: 1, in_review: 0 });
    expect(legalDate("2026-11-19")).toBe("November 19, 2026");
    expect(legalDate(null)).toBe("Not recorded");
  });
});
