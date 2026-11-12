import { describe, expect, it } from "vitest";
import { generateExclusions, generateScope, type AiCaller } from "@/lib/ai/proposal-text";
import { proposalConfigFrom } from "@/lib/data/mappers";
import { proposalConfigSchema } from "@/lib/estimate/schema";
import { contentHash, versionSnapshot } from "@/lib/export/snapshot";
import { renderProposalPdf } from "@/lib/pdf/render";
import { buildProposal } from "@/lib/proposal/build";
import { guardExclusions, ruleExclusions, ruleScope, scopeProblems } from "@/lib/proposal/generate-rules";
import {
  bidFingerprint, buildGenerationInput, customerExclusions, defaultExclusionSettings, normalizeExclusions, pushScopeHistory, scrubContact,
  type ExclusionItem, type GenerationInput,
} from "@/lib/proposal/text-sections";
import { defaultBusinessProfile, defaultProposalConfig, type ProposalConfig } from "@/lib/proposal/types";
import { est, item } from "./helpers";

const deck = () =>
  est({
    title: "New composite deck",
    customer: { name: "Pat Customer", email: "pat@example.com", phone: "555-201-3344", projectAddress: "12 Main St", notes: "Gate code 4411. Call pat@example.com or 555-201-3344. Wants it done before summer." },
    groups: [
      { id: "g1", name: "Decking", visibility: null, sortOrder: 0 },
      { id: "g2", name: "Structure", visibility: null, sortOrder: 1 },
      { id: "g3", name: "Labor", visibility: null, sortOrder: 2 },
    ],
    items: [
      item("g1", "400", "6.25", { name: "Trex composite decking", unit: "square foot" }),
      item("g2", "1", "900", { name: "Pressure-treated framing", unit: "lump sum" }),
      item("g2", "8", "85", { name: "Concrete footings" }),
      item("g2", "36", "42", { name: "Aluminum railing", unit: "linear foot" }),
      item("g2", "1", "650", { name: "Deck stairs" }),
      item("g3", "1", "4200", { name: "Installation labor", costType: "labor", unit: "lump sum" }),
      item("g3", "1", "300", { name: "Overhead allocation", costType: "overhead", unit: "lump sum" }),
    ],
  });

const biz = { ...defaultBusinessProfile(), companyName: "Acme Decks" };

const cfg = (patch: Partial<ProposalConfig> = {}): ProposalConfig => ({ ...defaultProposalConfig(), ...patch });

describe("scope generation input (privacy)", () => {
  it("never contains costs, prices, markup or customer contact details", () => {
    const input = buildGenerationInput(deck(), { kind: "scope", style: "professional", includeNotes: true });
    const json = JSON.stringify(input);
    for (const secret of ["6.25", "4200", "unitCost", "pricing", "markup", "Pat Customer", "pat@example.com", "555-201-3344", "12 Main St", "taxRate"]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(input.notes).toContain("[email removed]");
    expect(input.notes).toContain("[phone removed]");
  });

  it("leaves private notes out unless the contractor opts in", () => {
    expect(buildGenerationInput(deck(), { kind: "scope", style: "simple" }).notes).toBeUndefined();
  });

  it("drops example rows and empty sections", () => {
    const e = deck();
    e.items.push(item("g1", "1", "1", { name: "Example row", isExample: true }));
    e.groups.push({ id: "g9", name: "Empty", visibility: null, sortOrder: 9 });
    const input = buildGenerationInput(e, { kind: "scope", style: "simple" });
    expect(JSON.stringify(input)).not.toContain("Example row");
    expect(input.groups.map((g) => g.name)).toEqual(["Decking", "Structure", "Labor"]);
  });

  it("scrubs contact details from free text", () => {
    expect(scrubContact("mail a@b.co or call (555) 123-4567, see https://x.y/z")).toBe("mail [email removed] or call [phone removed], see [link removed]");
  });
});

describe("bid fingerprint (stale-scope notice)", () => {
  it("changes when the described work changes but not when only prices change", () => {
    const a = deck();
    const priced = { ...a, items: a.items.map((i) => ({ ...i, unitCost: "999" })), pricing: { mode: "margin" as const, percent: "40" } };
    const more = { ...a, items: a.items.map((i, k) => (k === 0 ? { ...i, quantity: "450" } : i)) };
    expect(bidFingerprint(priced)).toBe(bidFingerprint(a));
    expect(bidFingerprint(more)).not.toBe(bidFingerprint(a));
  });
});

describe("rule-based scope (works with no AI)", () => {
  const input = buildGenerationInput(deck(), { kind: "scope", style: "professional" });

  it("describes the bid using only its own facts, in every style", () => {
    for (const style of ["simple", "professional", "detailed"] as const) {
      const s = ruleScope(input, style);
      expect(s).toContain("400 sq. ft. Trex composite decking");
      expect(s.toLowerCase()).toContain("aluminum railing");
      expect(s).not.toMatch(/overhead/i);
      expect(scopeProblems(s, input), style).toEqual([]);
    }
  });

  it("returns nothing when the bid is empty", () => {
    expect(ruleScope(buildGenerationInput(est(), { kind: "scope", style: "simple" }))).toBe("");
  });
});

describe("scope guard", () => {
  const input = buildGenerationInput(deck(), { kind: "scope", style: "professional" });
  it("flags invented numbers and unsupported commitments", () => {
    expect(scopeProblems("Construct a 16 x 25 deck with Trex decking.", input).join()).toMatch(/numbers not in the estimate/);
    expect(scopeProblems("Includes a 5-year workmanship warranty.", input).join()).toMatch(/warranty/);
    expect(scopeProblems("Work includes permits and removal of existing deck.", input).join()).toMatch(/permit.*demolition|permit/);
    expect(scopeProblems("Construct an approximately 400-square-foot composite deck with 8 concrete footings.", input)).toEqual([]);
  });
});

describe("rule-based exclusions", () => {
  it("never excludes work that the estimate includes", () => {
    const e = deck();
    e.items.push(item("g2", "4", "60", { name: "Post cap lights" }), item("g2", "1", "250", { name: "Building permit", costType: "permit", unit: "lump sum" }));
    const cats = ruleExclusions(buildGenerationInput(e, { kind: "exclusions", style: "professional" })).map((x) => x.category);
    expect(cats).not.toContain("electrical");
    expect(cats).not.toContain("permits");
    expect(cats).toEqual(expect.arrayContaining(["landscaping", "unforeseen", "change_orders"]));
  });

  it("suggests the common deck exclusions as unapproved suggestions", () => {
    const items = ruleExclusions(buildGenerationInput(deck(), { kind: "exclusions", style: "professional" }));
    expect(items.map((x) => x.category)).toEqual(expect.arrayContaining(["permits", "electrical", "landscaping", "unforeseen", "change_orders"]));
    expect(items.every((x) => x.status === "suggested" && x.source === "generated")).toBe(true);
  });

  it("flags an exclusion for review when only the scope mentions that work", () => {
    const input = buildGenerationInput(deck(), { kind: "exclusions", style: "professional", scope: "Includes relocating the existing outdoor light." });
    const elec = ruleExclusions(input).find((x) => x.category === "electrical");
    expect(elec?.review).toMatch(/Confirm/);
  });

  it("does not repeat categories the contractor already has", () => {
    const existing: ExclusionItem[] = [{ id: "1", category: "permits", title: "Permits", text: "Not included", status: "approved", source: "manual" }];
    const input = buildGenerationInput(deck(), { kind: "exclusions", style: "simple", existing });
    expect(ruleExclusions(input).map((x) => x.category)).not.toContain("permits");
  });

  it("is trade-specific: no electrical exclusion on an electrical bid", () => {
    const e = { ...deck(), trades: ["electrical"] };
    expect(ruleExclusions(buildGenerationInput(e, { kind: "exclusions", style: "simple" })).map((x) => x.category)).not.toContain("electrical");
  });
});

describe("AI generation with guards and fallback", () => {
  const scopeInput = buildGenerationInput(deck(), { kind: "scope", style: "professional" });
  const exInput = (): GenerationInput => {
    const e = deck();
    e.items.push(item("g2", "4", "60", { name: "Post cap lights" }));
    return buildGenerationInput(e, { kind: "exclusions", style: "professional" });
  };
  const fakeAi = (data: unknown): AiCaller => (async () => ({ data, model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 400, costUsd: 0.0128 })) as unknown as AiCaller;

  it("uses a clean AI scope and reports usage", async () => {
    const r = await generateScope(scopeInput, { useAi: true, ai: fakeAi({ scope: "Construct a new composite deck using **Trex composite decking**.\n- Install 8 concrete footings" }) });
    expect(r).toMatchObject({ engine: "ai", status: "ok", generator: "ai:claude-opus-5-5:scope-v1" });
    expect(r.scope).toBe("Construct a new composite deck using Trex composite decking.\n• Install 8 concrete footings");
    expect(r.usage?.costUsd).toBeCloseTo(0.0128);
  });

  it("rejects an AI scope that invents details and falls back to the rules", async () => {
    const r = await generateScope(scopeInput, { useAi: true, ai: fakeAi({ scope: "Build a 20 x 20 deck with a lifetime warranty." }) });
    expect(r).toMatchObject({ engine: "rules", status: "rejected" });
    expect(r.scope).toContain("Trex composite decking");
  });

  it("falls back to the rules when the AI service fails", async () => {
    const r = await generateScope(scopeInput, { useAi: true, ai: (async () => { throw new Error("down"); }) as unknown as AiCaller });
    expect(r).toMatchObject({ engine: "rules", status: "failed" });
    expect(r.notice).toMatch(/isn't available/);
  });

  it("uses the rules when AI is not configured", async () => {
    const r = await generateScope(scopeInput, { useAi: false });
    expect(r).toMatchObject({ engine: "rules", status: "fallback" });
  });

  it("drops AI exclusions that contradict included work and keeps the rest as suggestions", async () => {
    const r = await generateExclusions(exInput(), {
      useAi: true,
      ai: fakeAi({
        items: [
          { category: "electrical", title: "Electrical", text: "Electrical work is excluded.", needs_review: false, review_reason: "" },
          { category: "Landscaping", title: "Landscaping:", text: "Sod restoration is excluded unless listed.", needs_review: false, review_reason: "" },
          { category: "custom", title: "Utilities", text: "Locating private underground lines is excluded.", needs_review: true, review_reason: "Depends on site." },
        ],
      }),
    });
    expect(r.engine).toBe("ai");
    expect(r.dropped).toBe(1);
    expect(r.items?.map((i) => i.category)).toEqual(["landscaping", "custom"]);
    expect(r.items?.every((i) => i.status === "suggested")).toBe(true);
    expect(r.items?.[0].title).toBe("Landscaping");
    expect(r.items?.[1].review).toBe("Depends on site.");
  });

  it("guard forces any status back to suggested", () => {
    const { kept } = guardExclusions([{ id: "x", category: "custom", title: "T", text: "Text", status: "approved", source: "manual" }], exInput());
    expect(kept[0]).toMatchObject({ status: "suggested", source: "generated" });
  });
});

describe("customer proposal visibility", () => {
  const items: ExclusionItem[] = [
    { id: "a", category: "permits", title: "Permits & Inspections", text: "Permit fees are excluded.", status: "approved", source: "generated" },
    { id: "b", category: "electrical", title: "Electrical", text: "Wiring is excluded.", status: "suggested", source: "generated" },
    { id: "c", category: "custom", title: "", text: "Owner supplies water.", status: "approved", source: "manual" },
    { id: "d", category: "custom", title: "Rejected", text: "Nope.", status: "rejected", source: "generated" },
  ];
  const withText = (scopeVisible: boolean, exVisible: boolean) =>
    cfg({ scopeOfWork: "SCOPE-TEXT build the deck", scope: { ...defaultProposalConfig().scope, visible: scopeVisible }, exclusionList: { ...defaultExclusionSettings(), visible: exVisible, items } });

  it("shows only approved exclusions, numbered", () => {
    expect(customerExclusions({ ...defaultExclusionSettings(), items })).toBe("1. Permits & Inspections: Permit fees are excluded.\n2. Owner supplies water.");
  });

  it("includes both sections when visible", () => {
    const doc = buildProposal(deck(), biz, withText(true, true));
    expect(doc.scopeOfWork).toBe("SCOPE-TEXT build the deck");
    expect(doc.exclusions).toContain("Permit fees");
    expect(doc.exclusions).not.toContain("Wiring");
    expect(doc.exclusions).not.toContain("Nope");
  });

  it("removes hidden sections from the customer document entirely", () => {
    const doc = buildProposal(deck(), biz, withText(false, false));
    const json = JSON.stringify(doc);
    expect(json).not.toContain("SCOPE-TEXT");
    expect(json).not.toContain("Permit fees");
    expect(doc.scopeOfWork).toBeUndefined();
    expect(doc.exclusions).toBeUndefined();
  });

  it("toggles each section independently", () => {
    const a = buildProposal(deck(), biz, withText(true, false));
    const b = buildProposal(deck(), biz, withText(false, true));
    expect([Boolean(a.scopeOfWork), Boolean(a.exclusions)]).toEqual([true, false]);
    expect([Boolean(b.scopeOfWork), Boolean(b.exclusions)]).toEqual([false, true]);
  });

  it("never shows empty sections even when visible", () => {
    const doc = buildProposal(deck(), biz, cfg({ scopeOfWork: "   ", exclusionList: { ...defaultExclusionSettings(), items: [items[1], items[3]] } }));
    expect(doc.scopeOfWork).toBeUndefined();
    expect(doc.exclusions).toBeUndefined();
  });

  it("the PDF reflects the visibility choice", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const textOf = async (buf: Buffer) => {
      const d = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
      let t = "";
      for (let p = 1; p <= d.numPages; p++) t += (await (await d.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
      return t;
    };
    const shown = await textOf(await renderProposalPdf(buildProposal(deck(), biz, withText(true, true)), null));
    const hidden = await textOf(await renderProposalPdf(buildProposal(deck(), biz, withText(false, false)), null));
    expect(shown).toContain("Scope of Work");
    expect(shown).toContain("SCOPE-TEXT");
    expect(shown).toContain("Exclusions & Clarifications");
    expect(hidden).not.toContain("SCOPE-TEXT");
    expect(hidden).not.toContain("Scope of Work");
    expect(hidden).not.toContain("Exclusions");
  });
});

describe("persistence and versioning", () => {
  it("round-trips through the save schema and loader", () => {
    const c = cfg({
      scopeOfWork: "Scope",
      scope: { ...defaultProposalConfig().scope, source: "edited", generator: "rules:scope-v1", basedOn: "abc", history: [{ at: "2026-11-12T00:00:00Z", content: "Old", source: "generated" }] },
      exclusionList: { ...defaultExclusionSettings(), items: [{ id: "a", category: "permits", title: "P", text: "T", status: "approved", source: "manual", review: null }] },
    });
    const parsed = proposalConfigSchema.parse(c);
    expect(proposalConfigFrom(parsed)).toEqual(c);
  });

  it("loads old estimates: default visibility on, legacy exclusions become approved items", () => {
    const loaded = proposalConfigFrom({ scopeOfWork: "Old scope", exclusions: "- Permits: not included\n- Painting" });
    expect(loaded.scope.visible).toBe(true);
    expect(loaded.exclusions).toBe("");
    expect(loaded.exclusionList.items.map((i) => [i.title, i.text, i.status])).toEqual([["Permits", "not included", "approved"], ["", "Painting", "approved"]]);
    expect(normalizeExclusions(null, "").items).toEqual([]);
  });

  it("history is capped and skips repeats", () => {
    let s = defaultProposalConfig().scope;
    for (let i = 0; i < 15; i++) s = { ...s, history: pushScopeHistory(s, `v${i}`) };
    s = { ...s, history: pushScopeHistory(s, "v14") };
    expect(s.history).toHaveLength(10);
    expect(s.history.at(-1)?.content).toBe("v14");
  });

  it("finalized snapshot freezes approved text but not editing history", () => {
    const base = cfg({ scopeOfWork: "Approved scope" });
    const withHistory = { ...base, scope: { ...base.scope, history: [{ at: "x", content: "draft", source: "manual" as const }] } };
    const e = deck();
    const a = versionSnapshot(e, biz, base);
    const b = versionSnapshot(e, biz, withHistory);
    expect(contentHash(a)).toBe(contentHash(b));
    expect(JSON.stringify(b)).not.toContain("draft");
    expect(b.proposalConfig.scopeOfWork).toBe("Approved scope");
    expect(contentHash(versionSnapshot(e, biz, { ...base, scopeOfWork: "Changed" }))).not.toBe(contentHash(a));
  });
});
