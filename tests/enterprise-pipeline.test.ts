import { describe, expect, it } from "vitest";
import { parseFilters, rangeStart, rpcArgs, toCsv, type PipelineRow } from "@/lib/enterprise/pipeline";

const row = (o: Partial<PipelineRow>): PipelineRow => ({
  id: "1", title: "Roof", estimate_number: "E-1", customer_name: "Ann", trades: ["roofing", "gutters"], pipeline_stage: "sent", status: "finalized",
  user_id: "u", owner_name: "Casey", total: "1200.00", margin_pct: "30.0", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-02T10:00:00Z",
  stage_changed_at: null, total_count: 1, ...o,
});

describe("pipeline filters", () => {
  it("drops invalid values and defaults to 90 days", () => {
    expect(parseFilters({ stage: "bogus", user: "x", team: "'; drop", q: "  ", range: "7y" })).toEqual({ stage: null, user: null, team: null, q: null, range: "90d" });
  });
  it("keeps valid values", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(parseFilters(new URLSearchParams({ stage: "won", user: id, q: " smith ", range: "all" }))).toEqual({ stage: "won", user: id, team: null, q: "smith", range: "all" });
  });
  it("range start", () => {
    const now = new Date("2026-11-14T00:00:00Z");
    expect(rangeStart("all", now)).toBeNull();
    expect(rangeStart("30d", now)).toBe("2026-10-15T00:00:00.000Z");
  });
  it("maps to RPC args", () => {
    expect(rpcArgs({ stage: "won", user: null, team: null, q: null, range: "all" }, 50, 100)).toMatchObject({ p_stage: "won", p_from: null, p_limit: 50, p_offset: 100 });
  });
});

describe("pipeline CSV", () => {
  it("quotes, joins trades and labels stages", () => {
    const csv = toCsv([row({ title: 'Roof, "big"' })], true);
    const [head, line] = csv.trim().split("\r\n");
    expect(head).toBe("Bid #,Title,Customer,Trades,Stage,Estimator,Total,Margin %,Created,Last updated,Stage changed");
    expect(line).toBe('E-1,"Roof, ""big""",Ann,roofing; gutters,Sent,Casey,1200.00,30.0,2026-11-01,2026-11-02,');
  });
  it("omits margin without permission", () => {
    expect(toCsv([row({})], false).split("\r\n")[0]).not.toContain("Margin");
  });
  it("neutralises spreadsheet formulas", () => {
    const line = toCsv([row({ customer_name: "=HYPERLINK(\"x\")", title: "+1", owner_name: "@me" })], false).split("\r\n")[1];
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain("'+1");
    expect(line).toContain("'@me");
  });
});
