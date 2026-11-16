import { describe, expect, it } from "vitest";
import { BANKS, painsFor } from "@/lib/bid-check/banks";
import { deepPath, hintSelections, mainComplete, mainPath, MAIN_LENGTH, parseArrival, pathAnswers, setAnswer } from "@/lib/bid-check/engine";
import { buildResult } from "@/lib/bid-check/result";
import { buildSample } from "@/lib/bid-check/sample";
import { computeEstimate } from "@/lib/estimate/engine";
import type { Answers } from "@/lib/bid-check/types";

/** Walk the main path the way the screen does: answer whatever question is next. */
function walk(choices: Record<string, string>, start: Answers = {}): { answers: Answers; asked: string[] } {
  let a = { ...start };
  const asked: string[] = [];
  for (let i = 0; i < 12; i++) {
    const next = mainPath(a).find((q) => a[q.id] === undefined);
    if (!next) break;
    asked.push(next.id);
    const v = choices[next.id];
    if (v === undefined) throw new Error(`no answer for ${next.id} (asked ${asked.join(", ")})`);
    a = setAnswer(a, next.id, v);
  }
  return { answers: a, asked };
}

const soloDeckSheets = { goal: "speed", trade: "decks", "decks.job": "new", "decks.pain": "stairs", "follow.speed": "takeoffs", tools: "excel" };
const deckProfitStairs = { goal: "profit", trade: "decks", "decks.job": "replacement", "decks.pain": "stairs", "decks.follow.profit.stairs": "package", tools: "notes" };
const painterProposals = { goal: "proposals", trade: "painting", "painting.job": "interior", "painting.pain": "materials", "painting.follow.proposals.materials": "coats", tools: "notes" };
const painterSpeedPrep = { goal: "speed", trade: "painting", "painting.job": "exterior", "painting.pain": "prep", "painting.follow.speed.prep": "repairs", tools: "mix" };
const remodelCrewFollowup = { goal: "followup", trade: "remodeling", "remodeling.job": "kitchens", "remodeling.pain": "subs", "follow.followup": "sheet", tools: "excel" };

describe("bid check branching", () => {
  it("every main path is exactly six questions and opens with the slowdown question", () => {
    for (const c of [soloDeckSheets, deckProfitStairs, painterProposals, painterSpeedPrep, remodelCrewFollowup]) {
      const { answers, asked } = walk(c);
      expect(asked).toHaveLength(MAIN_LENGTH);
      expect(asked[0]).toBe("goal");
      expect(mainPath({}).at(0)?.prompt).toBe("What's slowing down your bids?");
      expect(mainComplete(answers)).toBe(true);
    }
  });

  it("asks a trade-specific question right after the trade, with each trade's own bank", () => {
    const prompts = BANKS.map((b) => mainPath({ goal: "speed", trade: b.key })[2].prompt);
    expect(new Set(prompts).size).toBe(BANKS.length);
    for (const b of BANKS) {
      const q = mainPath({ goal: "speed", trade: b.key })[2];
      expect(q.id).toBe(`${b.key}.job`);
      expect(q.options.map((o) => o.value)).toEqual(b.jobs.map((j) => j.value));
    }
  });

  it("same trade, different goals: different follow-up question, example and recommendation", () => {
    const speed = walk(soloDeckSheets);
    const profit = walk(deckProfitStairs);
    expect(speed.asked[4]).toBe("follow.speed");
    expect(profit.asked[4]).toBe("decks.follow.profit.stairs");
    const rs = buildResult(speed.answers)!;
    const rp = buildResult(profit.answers)!;
    expect(rs.headline).toBe("Turn your deck spreadsheet into a bid you can send.");
    expect(rp.headline).toBe("See what you'll make before you send the bid.");
    expect(rs.example).toBe("estimate");
    expect(rp.example).toBe("profit");
    expect(rp.tryNext).toMatch(/stringers, treads and labor/);
    expect(rs.tryNext).not.toEqual(rp.tryNext);
    // Replacement adds demolition; the stair section is broken out into labor and materials.
    const sp = buildSample(profit.answers)!;
    expect(sp.estimate.groups.map((g) => g.name)).toEqual(["Demolition", "Footings & Framing", "Decking", "Stairs", "Railings"]);
    const stairs = sp.estimate.items.filter((i) => i.groupId === sp.focusGroupId);
    expect(sp.focusGroupName).toBe("Stairs");
    expect(stairs.some((i) => i.costType === "labor")).toBe(true);
    expect(stairs.some((i) => i.costType === "material")).toBe(true);
    // Every other section is a single package line.
    for (const g of sp.estimate.groups.filter((x) => x.id !== sp.focusGroupId)) expect(sp.estimate.items.filter((i) => i.groupId === g.id)).toHaveLength(1);
    expect(computeEstimate(sp.estimate).grossProfit.toNumber()).toBeGreaterThan(0);
  });

  it("painter with prep + faster estimates gets the prep branch; painter wanting proposals gets the paint branch", () => {
    const prep = walk(painterSpeedPrep);
    expect(prep.asked[4]).toBe("painting.follow.speed.prep");
    expect(mainPath(prep.answers)[4].options.map((o) => o.label)).toEqual(["Measuring the surfaces", "Estimating repairs", "Writing the prep scope"]);
    const prop = walk(painterProposals);
    expect(prop.asked[4]).toBe("painting.follow.proposals.materials");
    const r = buildResult(prop.answers)!;
    expect(r.headline).toBe("Give your customer a clear scope and price.");
    expect(r.example).toBe("proposal");
    expect(r.action).toMatchObject({ kind: "open_sample", step: "proposal" });
    const s = buildSample(prep.answers)!;
    expect(s.focusGroupName).toBe("Prep & Repairs");
    expect(s.estimate.groups.map((g) => g.name)).toContain("Access & Setup"); // exterior job
    expect(buildSample(prop.answers)!.estimate.groups.map((g) => g.name)).toContain("Access & Setup"); // interior has access too
  });

  it("remodeling crew focused on follow-up sees the Pipeline, a team tip after bonus answers, and the pending-feature note", () => {
    const { answers, asked } = walk(remodelCrewFollowup);
    expect(asked[4]).toBe("follow.followup");
    let a = setAnswer(answers, "who", "pair");
    expect(deepPath(a).map((q) => q.id)).toContain("team.problem");
    a = setAnswer(a, "team.problem", "handoffs");
    const r = buildResult(a)!;
    expect(r.headline).toBe("See which bids are still open.");
    expect(r.example).toBe("pipeline");
    expect(r.action.kind).toBe("dashboard");
    expect(r.teamTip).toMatch(/same bid/);
    expect(r.followupNote).toMatch(/Automatic follow-up reminders aren't built yet/);
    expect(deepPath(a).map((q) => q.id)).toContain("followup.track");
    expect(r.templateSlug).toBe("kitchens");
  });

  it("the three persona results are all different", () => {
    const keys = [soloDeckSheets, painterProposals, remodelCrewFollowup].map((c) => buildResult(walk(c).answers)!);
    expect(new Set(keys.map((k) => k.headline)).size).toBe(3);
    expect(new Set(keys.map((k) => k.example)).size).toBe(3);
    expect(new Set(keys.map((k) => k.templateSlug)).size).toBe(3);
  });

  it("skips questions that don't apply to the kind of job", () => {
    const roofNew = painsFor(BANKS.find((b) => b.key === "roofing")!, "new").map((p) => p.value);
    expect(roofNew).not.toContain("tearoff");
    expect(roofNew).not.toContain("decking");
    expect(painsFor(BANKS.find((b) => b.key === "decks")!, "resurfacing").map((p) => p.value)).not.toContain("footings");
    expect(painsFor(BANKS.find((b) => b.key === "painting")!, "cabinets").map((p) => p.value)).not.toContain("access");
    expect(painsFor(BANKS.find((b) => b.key === "drywall")!, "new").map((p) => p.value)).not.toContain("texture");
    // The screen offers only those options.
    const q = mainPath({ goal: "speed", trade: "roofing", "roofing.job": "new" })[3];
    expect(q.options.map((o) => o.value)).toEqual(["pitch", "materials"]);
  });

  it("switching trade mid-flow clears the old trade's answers and never leaks them into the result", () => {
    const deck = walk(soloDeckSheets).answers;
    let a = setAnswer(deck, "trade", "painting");
    expect(Object.keys(a).filter((k) => k.startsWith("decks."))).toEqual([]);
    expect(a.goal).toBe("speed");
    expect(a.tools).toBe("excel"); // still applies
    expect(mainComplete(a)).toBe(false);
    a = setAnswer(a, "painting.job", "interior");
    a = setAnswer(a, "painting.pain", "labor");
    expect(mainComplete(a)).toBe(true); // follow.speed and tools were kept: they still apply
    const r = buildResult(a)!;
    expect(r.templateSlug).toBe("painting");
    expect(JSON.stringify(r)).not.toMatch(/deck|stair/i);
    expect(buildSample(a)!.estimate.groups.map((g) => g.name)).not.toContain("Stairs");
    // A stale answer smuggled into the state is ignored: only path answers count.
    const polluted = { ...a, "decks.pain": "stairs", "decks.job": "new" };
    expect(pathAnswers(polluted)["decks.pain"]).toBeUndefined();
    expect(buildResult(polluted)!.key).toBe(r.key);
  });

  it("changing the goal swaps the follow-up and drops the old one from the result", () => {
    const a = setAnswer(walk(deckProfitStairs).answers, "goal", "speed");
    expect(mainPath(a)[4].id).toBe("follow.speed");
    expect(mainComplete(a)).toBe(false);
    expect(pathAnswers(a)["decks.follow.profit.stairs"]).toBeUndefined();
  });

  it("multiple trades: asks which trade first, keeps six questions, moves tools to the bonus path", () => {
    const { answers, asked } = walk({ goal: "profit", trade: "multiple", "multi.first": "concrete", "concrete.job": "flatwork", "concrete.pain": "volume", "concrete.follow.profit.volume": "round" });
    expect(asked).toEqual(["goal", "trade", "multi.first", "concrete.job", "concrete.pain", "concrete.follow.profit.volume"]);
    expect(deepPath(answers).map((q) => q.id)).toContain("tools");
    expect(buildResult(answers)!.templateSlug).toBe("concrete");
  });

  it("other trade: catalog trades get their own short path; something else asks what they build", () => {
    const fl = walk({ goal: "speed", trade: "other", "other.what": "flooring", "flooring.job": "p0", "flooring.pain": "g0", "follow.speed": "prices" });
    expect(fl.asked).toHaveLength(6);
    const rf = buildResult(fl.answers)!;
    expect(rf.example).toBe("template");
    expect(rf.action.kind).toBe("start_bid");
    expect(rf.freeBidHref).toBe("/start/flooring");
    const c = walk({ goal: "proposals", trade: "other", "other.what": "custom", "custom.describe": "Sunrooms", "custom.pain": "scope", "follow.proposals": "included" });
    expect(c.asked).toEqual(["goal", "trade", "other.what", "custom.describe", "custom.pain", "follow.proposals"]);
    expect(buildResult(c.answers)!.trade).toBe("Sunrooms");
  });

  it("occasional bidders get the free bid first; regular or unknown volume gets the pass first", () => {
    const a = walk(soloDeckSheets).answers;
    expect(buildResult(a)!.primary).toBe("pass");
    expect(buildResult(setAnswer(a, "volume", "0-1"))!.primary).toBe("free_bid");
    expect(buildResult(setAnswer(a, "volume", "11-25"))!.primary).toBe("pass");
    expect(buildResult(setAnswer(a, "volume", "varies"))!.primary).toBe("pass");
  });

  it("bonus answers change the example (decking material, allowances at cost, margin pricing)", () => {
    const a = walk(soloDeckSheets).answers;
    expect(buildSample(setAnswer(a, "decks.deep", "pt"))!.estimate.items.some((i) => /pressure-treated deck boards/i.test(i.name))).toBe(false); // stairs is the focus; decking is a package
    const decking = setAnswer(setAnswer(a, "decks.pain", "decking"), "decks.deep", "pt");
    expect(buildSample(decking)!.estimate.items.some((i) => /pressure-treated deck boards/i.test(i.name))).toBe(true);
    const remodel = walk({ goal: "profit", trade: "remodeling", "remodeling.job": "bathrooms", "remodeling.pain": "allowances", "remodeling.follow.profit.allowances": "no", tools: "software" }).answers;
    const s = buildSample(remodel)!;
    expect(s.estimate.items.filter((i) => /allowance/i.test(i.name)).every((i) => i.treatment === "pass_through")).toBe(true);
    expect(s.estimate.groups.some((g) => g.name === "Allowances")).toBe(true);
    expect(s.estimate.items.some((i) => /vanity/i.test(i.name))).toBe(true); // bathroom-specific lines
    const margin = walk({ goal: "profit", trade: "siding", "siding.job": "full", "siding.pain": "trim", "follow.profit": "margin", tools: "excel" }).answers;
    expect(buildSample(margin)!.estimate.pricing.mode).toBe("margin");
  });

  it("link hints preselect the trade (and kind of remodel) without answering for the contractor", () => {
    expect(hintSelections("painting")).toEqual({ trade: "painting" });
    expect(hintSelections("kitchens")).toEqual({ trade: "remodeling", "remodeling.job": "kitchens" });
    expect(hintSelections("flooring")).toEqual({ trade: "other", "other.what": "flooring" });
    expect(hintSelections("<script>")).toEqual({});
    const arr = parseArrival({ trade: "painting", utm_source: "facebook", utm_medium: "group", utm_campaign: "bid_check_painters", utm_content: "group_v1" });
    expect(arr).toEqual({ campaign: "bid_check_painters", source: "fb_group", content: "group_v1", tradeHint: "painting" });
    expect(parseArrival({ trade: "nonsense", c: "x y" })).toEqual({ campaign: null, source: null, content: null, tradeHint: null });
    expect(parseArrival({ utm_medium: "messenger", utm_campaign: "fb_bid_decks" }).source).toBe("fb_messenger");
  });

  it("every bank's sample builds, prices, and breaks out each pain point for every kind of job", () => {
    for (const b of BANKS) for (const j of b.jobs) for (const p of painsFor(b, j.value)) {
      const a = { goal: "profit", trade: b.key, [`${b.key}.job`]: j.value, [`${b.key}.pain`]: p.value } as Answers;
      const s = buildSample(a)!;
      expect(s.focusGroupId, `${b.key}/${j.value}/${p.value}`).not.toBeNull();
      const t = computeEstimate(s.estimate);
      expect(t.issues.map((i) => i.code)).toEqual([]);
      expect(t.total.toNumber()).toBeGreaterThan(0);
      expect(s.estimate.items.filter((i) => i.groupId === s.focusGroupId).length).toBeGreaterThan(1);
    }
  });
});

describe("Messenger link to the bid check", () => {
  it("is off by default and carries the post's trade hint and campaign when on", async () => {
    const { trialConfig } = await import("@/lib/trial/config");
    const { bidCheckUrl, replyToComment } = await import("@/lib/trial/flow");
    const off = trialConfig({ META_PAGE_ID: "999" });
    const on = trialConfig({ META_PAGE_ID: "999", META_BID_CHECK_LINK: "true", META_POST_TRADES: "999_1:painting, bad:x, 999_2:decks" });
    expect(off.bidCheckLink).toBe(false);
    expect(on.postTrades).toEqual({ "999_1": "painting", "999_2": "decks" });
    const url = new URL(bidCheckUrl(on, "999_1"));
    expect(url.pathname).toBe("/bid-check");
    expect(Object.fromEntries(url.searchParams)).toEqual({ trade: "painting", utm_source: "facebook", utm_medium: "messenger", utm_campaign: "fb_bid_painting", utm_content: "post_999_1" });
    expect(parseArrival(Object.fromEntries(url.searchParams))).toMatchObject({ source: "fb_messenger", tradeHint: "painting", campaign: "fb_bid_painting" });
    const sent: string[] = [];
    const deps = (cfg: typeof on) => ({ cfg, store: { finishEvent: async () => {} } as never, privateReply: async (_c: string, m: { text: string }) => { sent.push(m.text); return { ok: true as const }; }, message: async () => ({ ok: true as const }) });
    await replyToComment(1, "c1", deps(off), "999_1");
    await replyToComment(2, "c2", deps(on), "999_1");
    expect(sent[0]).not.toMatch(/bid-check/);
    expect(sent[1]).toMatch(/built2bid\.org\/bid-check\?trade=painting/);
  });
});
