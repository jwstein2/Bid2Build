import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIPS, zipStatusFor, type GeoOption } from "@/lib/academy/kb/geo";
import { categoryFor, displayStatus, pickAnswer, searchOutcome, STATUS } from "@/lib/academy/kb/answer";
import { examplesFor, EXAMPLES } from "@/lib/academy/kb/examples";
import { TRADE_CATEGORIES, tradeStatus } from "@/lib/academy/kb/coverage";
import { trades } from "@/lib/trades/catalog";
import type { KbResult } from "@/lib/academy/kb/types";

const opt = (id: string): GeoOption => ({ id, label: id, kind: "city", share: 1 });
const base = { zip: "", loading: false, shardStatus: null, options: [], state: null } as Parameters<typeof zipStatusFor>[0];

describe("ZIP and local jurisdiction: six distinct situations", () => {
  it("separates empty, incomplete and loading", () => {
    expect(zipStatusFor(base)).toBe("none");
    expect(zipStatusFor({ ...base, zip: "961" })).toBe("incomplete");
    expect(zipStatusFor({ ...base, zip: "96101", loading: true })).toBe("loading");
  });
  it("resolved, multiple, valid-without-local-data, unknown, failed and mismatch each get their own status", () => {
    expect(zipStatusFor({ ...base, zip: "96103", shardStatus: "ok", options: [opt("CA:plumas-county")], state: "CA" })).toBe("resolved");
    expect(zipStatusFor({ ...base, zip: "96101", shardStatus: "ok", options: [opt("CA:modoc-county"), opt("CA:alturas")], state: "CA" })).toBe("multiple");
    expect(zipStatusFor({ ...base, zip: "96101", shardStatus: "ok", options: [], state: "CA" })).toBe("no_local_data");
    expect(zipStatusFor({ ...base, zip: "96199", shardStatus: "unknown", state: "CA" })).toBe("unknown");
    expect(zipStatusFor({ ...base, zip: "96101", shardStatus: "failed", state: "CA" })).toBe("failed");
    expect(zipStatusFor({ ...base, zip: "55902", shardStatus: "ok", options: [opt("MN:rochester")], state: "CA" })).toBe("mismatch");
  });
  it("96199 is not a Census ZIP (so it is 'not recognized', never a hard error)", () => {
    const shard = JSON.parse(readFileSync(join("public/academy-geo", "961.json"), "utf8"));
    expect(shard["96199"]).toBeUndefined();
    expect(shard["96101"]).toBeDefined();
  });
  it("every state and DC has at least one ZIP that resolves to it", () => {
    const seen = new Set<string>();
    for (const f of readdirSync("public/academy-geo").filter((n) => n.endsWith(".json"))) {
      const shard = JSON.parse(readFileSync(join("public/academy-geo", f), "utf8")) as Record<string, [string][]>;
      for (const opts of Object.values(shard)) for (const o of opts) seen.add(o[0].slice(0, 2));
    }
    const states = Object.values(FIPS).filter((s) => s !== "PR");
    expect(states.length).toBe(51);
    for (const s of states) expect(seen.has(s), s).toBe(true);
  });
});

const r = (p: Partial<KbResult>): KbResult => ({
  section_id: "x", source_id: "s", citation: "c", section_number: "1", title: "t", kind: "requirement", body_kind: "full_text", body: "b", summary: null,
  exceptions: null, page: null, trades: [], topics: [], official_url: null, section_status: "verified", last_verified_at: null, source_title: "T",
  source_short: "T", edition: "2024", family_slug: "irc", family_name: "IRC", publisher: "p", rights: "government_edict", read_url: null,
  source_jurisdiction: null, pagination_note: null, amends_section: null, amend_action: null, applicability: { status: "verified_applicable" },
  match: "terminology", rank: 5, ...p,
} as KbResult);

describe("Quick answers and search outcomes", () => {
  it("an OSHA jobsite-stair rule never answers a deck stair question when the building code leads", () => {
    const osha = r({ family_slug: "osha_construction", citation: "29 CFR 1926.1052", rank: 4 });
    const irc = r({ family_slug: "irc", body_kind: "title_only", section_status: "verified", rank: 6, applicability: { status: "verified_applicable" } });
    expect(pickAnswer([osha, irc])).toBeNull();
    expect(searchOutcome({ ok: true, results: [osha, irc] })).toBe("reference");
  });
  it("answers from the leading group when it is verified text", () => {
    const mn = r({ family_slug: "mn_rules", citation: "Minn. R. 1309.0311", rank: 6 });
    expect(pickAnswer([mn, r({ family_slug: "osha_construction", rank: 4 })])?.citation).toBe("Minn. R. 1309.0311");
    expect(searchOutcome({ ok: true, results: [mn] })).toBe("answer");
  });
  it("idle, error and no match are different outcomes", () => {
    expect(searchOutcome(null)).toBe("idle");
    expect(searchOutcome({ ok: false, results: [] })).toBe("error");
    expect(searchOutcome({ ok: true, results: [] })).toBe("no_match");
  });
});

describe("Public statuses", () => {
  it("maps applicability to the six plain labels", () => {
    expect(displayStatus(r({}), "MN")).toBe(STATUS.verified);
    expect(displayStatus(r({ applicability: { status: "jurisdiction_confirmation_needed" }, source_jurisdiction: "CA" }), "CA")).toBe(STATUS.statewide);
    expect(displayStatus(r({ applicability: { status: "jurisdiction_confirmation_needed" } }), "CA")).toBe(STATUS.local);
    expect(displayStatus(r({ applicability: { status: "superseded" } }), "CA")).toBe(STATUS.historical);
    expect(displayStatus(r({ applicability: { status: "source_review_needed" } }), "CA")).toBe(STATUS.review);
    expect(displayStatus(r({ applicability: { status: "not_adopted" } }), "CA")).toBe(STATUS.reference);
    expect(displayStatus(r({ body_kind: "title_only" }), "CA")).toBe(STATUS.review);
  });
  it("categorizes CALGreen and state-written codes by title", () => {
    expect(categoryFor("state_green", "2025 California Green Building Standards Code (CALGreen, Title 24, Part 11)")).toBe("green");
    expect(categoryFor("irc")).toBe("residential");
    expect(categoryFor("state_building", "California Electrical Code")).toBe("electrical");
  });
});

describe("Examples and trade coverage", () => {
  it("only suggests state-text examples where state text exists", () => {
    const fed = new Set(EXAMPLES.filter((e) => e.needs === "federal").map((e) => e.q));
    for (const q of examplesFor("roofing", false)) expect(fed.has(q), q).toBe(true);
    expect(examplesFor("roofing", true)[0]).toBe("roof underlayment");
    expect(examplesFor(null, false).length).toBeLessThanOrEqual(6);
  });
  it("every catalog trade has a coverage mapping", () => {
    for (const t of trades) expect(TRADE_CATEGORIES[t.slug], t.slug).toBeDefined();
  });
  it("a trade takes the best status of its codebooks; trades with none are not gaps", () => {
    expect(tradeStatus("roofing", { residential: { status: "reference" }, energy: { status: "pending" } })).toBe("reference");
    expect(tradeStatus("electrical", {})).toBe("none");
    expect(tradeStatus("cleaning", {})).toBeNull();
  });
});
