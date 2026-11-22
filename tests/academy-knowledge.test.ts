import { describe, expect, it } from "vitest";
import { locationFrom, locationQuery, parseLocationCookie, serializeLocation, stateForZip } from "@/lib/academy/kb/location";
import { groupFor, groupResults, isAnswered, pickAnswer } from "@/lib/academy/kb/answer";
import { compare, fingerprintText, planFor } from "@/lib/academy/kb/monitor";
import { KB_DISCLAIMER, KB_UNVERIFIED, citationText, sectionFromQuery, type KbResult } from "@/lib/academy/kb/types";

const result = (over: Partial<KbResult> = {}): KbResult => ({
  section_id: "00000000-0000-0000-0000-000000000001", source_id: "s", citation: "Minn. R. 1309.0311, subp. 2", section_number: "1309.0311 subp. 2",
  title: "Stairways", kind: "amendment", body_kind: "excerpt", body: "text", summary: "summary", exceptions: null, page: null, trades: ["decks"], topics: ["stairs"],
  official_url: "https://www.revisor.mn.gov/rules/1309.0311/", section_status: "verified", last_verified_at: "2026-11-22T00:00:00Z", source_title: "Minnesota Rules",
  source_short: "Minn. R. 1309", edition: "2020 Minnesota State Building Code", family_slug: "mn_rules", family_name: "Minnesota Rules", publisher: "MN", rights: "government_edict",
  read_url: null, source_jurisdiction: "MN", pagination_note: null, amends_section: "R311.7", amend_action: "amended",
  applicability: { status: "jurisdiction_confirmation_needed", reason: "local_not_selected" }, match: "terminology", rank: 6, ...over,
});

describe("Academy code library: required wording", () => {
  it("uses the exact disclaimer and unverified messages from the spec", () => {
    expect(KB_DISCLAIMER).toBe("Educational information only. Building codes and licensing requirements vary by jurisdiction and may change. Verify requirements with the applicable authority having jurisdiction before beginning work.");
    expect(KB_UNVERIFIED).toBe("Unable to verify the applicable requirement from the available official sources. Confirm with your local building department or authority having jurisdiction.");
  });
});

describe("Academy location", () => {
  it("lets a ZIP suggest a state", () => {
    expect(locationFrom({ zip: "55901" }, "saved")).toMatchObject({ zip: "55901", state: "MN", local: null });
    expect(stateForZip("55901")).toBe("MN");
  });
  it("lets an explicit state override the ZIP (researching another state)", () => {
    expect(locationFrom({ zip: "55901", state: "TX" }, "saved").state).toBe("TX");
  });
  it("supports DC and rejects territories and junk", () => {
    expect(locationFrom({ state: "DC" }, "saved").state).toBe("DC");
    expect(locationFrom({ state: "PR" }, "saved").state).toBeNull();
    expect(locationFrom({ state: "ZZ" }, "saved")).toMatchObject({ state: null, from: "none" });
  });
  it("never accepts a local jurisdiction outside the chosen state or without a state", () => {
    expect(locationFrom({ state: "MN", local: "MN:rochester" }, "saved").local).toBe("MN:rochester");
    expect(locationFrom({ state: "WI", local: "MN:rochester" }, "saved").local).toBeNull();
    expect(locationFrom({ local: "MN:rochester" }, "saved").local).toBeNull();
    expect(locationFrom({ state: "MN", local: "MN:<script>" }, "saved").local).toBeNull();
  });
  it("validates trade slugs", () => {
    expect(locationFrom({ trade: "decks" }, "saved").trade).toBe("decks");
    expect(locationFrom({ trade: "Decks; drop" }, "saved").trade).toBeNull();
  });
  it("round-trips through the cookie and ignores bad cookies", () => {
    const loc = locationFrom({ zip: "55901", trade: "decks" }, "saved");
    expect(parseLocationCookie(serializeLocation(loc))).toMatchObject({ zip: "55901", state: "MN", trade: "decks" });
    expect(parseLocationCookie("not json")).toBeNull();
    expect(parseLocationCookie(JSON.stringify({}))).toBeNull();
  });
  it("carries the location between modes in the query string", () => {
    expect(locationQuery({ zip: "55901", state: "MN", local: null, trade: "decks" }, { q: "stairs" })).toBe("?zip=55901&state=MN&trade=decks&q=stairs");
    expect(locationQuery({ zip: null, state: null, local: null, trade: null })).toBe("");
  });
});

describe("Academy code search presentation", () => {
  it("answers only from a verified section that matched on section number or approved terminology", () => {
    expect(pickAnswer([result()])?.section_id).toBe(result().section_id);
    expect(pickAnswer([result({ match: "keyword" })])).toBeNull();
    expect(pickAnswer([result({ section_status: "pending_review" })])).toBeNull();
    expect(pickAnswer([result({ body_kind: "title_only", body: null })])).toBeNull();
    expect(pickAnswer([result({ rank: 1 })])).toBeNull();
  });
  it("never answers with a rule that does not apply where the visitor is", () => {
    for (const status of ["source_review_needed", "not_adopted", "superseded", "unavailable"] as const) {
      expect(pickAnswer([result({ applicability: { status } })])).toBeNull();
    }
    expect(isAnswered([result({ applicability: { status: "verified_applicable" } })])).toBe(true);
    expect(isAnswered([])).toBe(false);
  });
  it("separates worker-safety, DOT and EPA rules from building codes", () => {
    expect(groupFor({ family_slug: "osha_construction", kind: "requirement" })).toBe("safety");
    expect(groupFor({ family_slug: "fmcsa", kind: "requirement" })).toBe("transport");
    expect(groupFor({ family_slug: "epa_lead_rrp", kind: "requirement" })).toBe("environment");
    expect(groupFor({ family_slug: "mn_rules", kind: "administrative" })).toBe("adoption");
    expect(groupFor({ family_slug: "irc", kind: "title_only" })).toBe("building");
    const g = groupResults([result({ family_slug: "osha_construction" }), result()]);
    expect(g.map((x) => x.group)).toEqual(["building", "safety"]);
  });
  it("builds a copyable citation without inventing a page", () => {
    const c = citationText(result());
    expect(c).toContain("Minn. R. 1309.0311, subp. 2");
    expect(c).toContain("https://www.revisor.mn.gov/rules/1309.0311/");
    expect(c).toContain("Last verified 2026-11-22");
    expect(c).not.toMatch(/\bp\. \d/);
    expect(citationText(result({ page: "112" }))).toContain("p. 112");
  });
  it("pulls section numbers out of questions", () => {
    expect(sectionFromQuery("what does R311.7.5.1 say")).toBe("R311.7.5.1");
    expect(sectionFromQuery("1926.501(b)(13) residential")).toBe("1926.501(b)(13)");
    expect(sectionFromQuery("deck stairs")).toBeNull();
  });
});

describe("Academy source monitoring", () => {
  it("plans eCFR checks on the versioner (never the daily-changing page)", () => {
    expect(planFor("https://www.ecfr.gov/current/title-29/section-1926.651")).toEqual({
      kind: "ecfr", section: "1926.651", fetchUrl: "https://www.ecfr.gov/api/versioner/v1/versions/title-29.json?section=1926.651",
    });
    expect(planFor("https://www.revisor.mn.gov/rules/1309.0311/")?.kind).toBe("revisor");
    expect(planFor("https://www.dli.mn.gov/business/codes-and-laws")?.kind).toBe("reachability");
    expect(planFor("http://insecure.example.com/")).toBeNull();
    expect(planFor("not a url")).toBeNull();
  });
  it("fingerprints only substantive eCFR amendments", () => {
    const plan = planFor("https://www.ecfr.gov/current/title-29/section-1926.651")!;
    const body = JSON.stringify({ content_versions: [
      { identifier: "1926.651", amendment_date: "2016-09-01", substantive: true },
      { identifier: "1926.651", amendment_date: "2016-09-01", substantive: false },
      { identifier: "1926.652", amendment_date: "2020-01-01", substantive: true },
    ] });
    expect(fingerprintText(plan, body)).toBe("2016-09-01");
    expect(fingerprintText(plan, "<html>")).toBeNull();
  });
  it("ignores the Revisor's publication stamp", () => {
    const plan = planFor("https://www.revisor.mn.gov/rules/1309.0311/")!;
    const page = (stamp: string) => `<html><div id="rule"><p>1309.0311 STAIRWAYS. Subpart 1. Stairway width. The stairway shall be not less than 36 inches.</p><p>Published Electronically: ${stamp}</p></div><div id="footer"></div></html>`;
    expect(fingerprintText(plan, page("March 2, 2020"))).toBe(fingerprintText(plan, page("June 9, 2026")));
    expect(fingerprintText(plan, "<html>no rule here</html>")).toBeNull();
  });
  it("treats the first fingerprint as a baseline and a reachable page as unverified", () => {
    const eplan = planFor("https://www.ecfr.gov/current/title-29/section-1926.651")!;
    expect(compare(eplan, 200, "abc", null).result).toBe("baseline");
    expect(compare(eplan, 200, "abc", "abc").result).toBe("unchanged");
    expect(compare(eplan, 200, "abd", "abc").result).toBe("changed");
    expect(compare(eplan, 404, null, "abc").result).toBe("unreachable");
    expect(compare(eplan, 200, null, "abc").result).toBe("unreachable");
    const rplan = planFor("https://www.dli.mn.gov/x")!;
    expect(compare(rplan, 200, null, null)).toEqual({ result: "reachable", hash: null, method: "url_check" });
    expect(compare(rplan, 0, null, null).result).toBe("unreachable");
  });
});

describe("Academy source monitoring: HTML handling", () => {
  it("drops scripts in any case and decodes entities once", () => {
    const plan = planFor("https://www.revisor.mn.gov/rules/1309.0311/")!;
    const t = fingerprintText(plan, `<div id="rule"><SCRIPT>x()</SCRIPT ><p>1309.0311 STAIRWAYS. Width&nbsp;36 inches &amp;nbsp; and &sect; 2 of the rule text here.</p></div><div id="footer">`);
    expect(t).not.toContain("x()");
    expect(t).toContain("Width 36 inches &nbsp; and § 2");
  });
});
