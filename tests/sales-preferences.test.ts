import { describe, expect, it } from "vitest";
import { answeredCount, cleanAnswers, preferenceSummary, QUESTIONS, recommendedLayout, sectionOrder } from "@/lib/sales/preferences";
import { congratsHtml, sendCongrats } from "@/lib/sales/congrats-email";

describe("V8.4 preferences survey", () => {
  it("has 20 optional questions and asks nothing sensitive", () => {
    expect(QUESTIONS).toHaveLength(20);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(20);
    const text = JSON.stringify(QUESTIONS).toLowerCase();
    for (const w of ["age", "gender", "race", "religion", "disab", "diagnos", "medical", "married", "children", "pregnan", "debt", "salary"]) {
      expect(text).not.toMatch(new RegExp(`\\b${w}`));
    }
  });

  it("keeps only known questions and options, within limits", () => {
    const a = cleanAnswers({ q1: "money", q2: ["closed_sale", "learned", "bogus", "list_done"], q4: "loud", q13: "  Fishing  ", q99: "x", q20: "y".repeat(900) });
    expect(a).toEqual({ q1: "money", q2: ["closed_sale", "learned"], q13: "Fishing", q20: "y".repeat(500) });
    expect(answeredCount(a)).toBe(4);
    expect(cleanAnswers({})).toEqual({});
  });

  it("recommends a layout only as a suggestion and never hides a section", () => {
    expect(recommendedLayout({ q1: "money" })).toBe("earnings");
    expect(recommendedLayout({ q1: "team" })).toBe("team");
    expect(recommendedLayout({ q1: "independence" })).toBe("portfolio");
    expect(recommendedLayout({})).toBe("progress");
    for (const l of ["progress", "earnings", "team", "portfolio"] as const) expect([...sectionOrder(l)].sort()).toEqual(["earnings", "portfolio", "progress", "team"]);
  });

  it("summarizes in plain words with no scores or types", () => {
    const s = preferenceSummary({ q1: "achievement", q3: ["quiet_note"], q4: "private", q11: ["training"], q13: "Golf" });
    expect(s.map((r) => r.label)).toEqual(["What motivates you", "How you like to be recognized", "Rewards you'd enjoy", "Hobbies and interests"]);
    expect(JSON.stringify(s)).not.toMatch(/score|type|level/i);
  });
});

describe("V8.4 owner congratulations email", () => {
  it("escapes the message into simple HTML", () => {
    expect(congratsHtml("Hey <b>Rita</b>,\n\nCarry on,\nsoldier.")).toContain("<p style=\"margin:0 0 16px\">Hey &lt;b&gt;Rita&lt;/b&gt;,</p><p style=\"margin:0 0 16px\">Carry on,<br>soldier.</p>");
  });

  it("sends once per row with an idempotency key, and reports failures", async () => {
    const calls: RequestInit[] = [];
    const ok = (async (_u: string, init: RequestInit) => { calls.push(init); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }) as unknown as typeof fetch;
    const cfg = { enabled: true, apiKey: "test", from: "\"James\" <james@built2bid.org>", replyTo: "james@built2bid.org" };
    expect(await sendCongrats(cfg, { id: "abc", to: "rep@example.test", subject: "S", body: "B" }, ok)).toEqual({ ok: true, id: "re_1" });
    expect((calls[0].headers as Record<string, string>)["idempotency-key"]).toBe("sales-congrats/abc");
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ from: cfg.from, to: ["rep@example.test"], subject: "S" });
    const bad = (async () => new Response(JSON.stringify({ name: "validation_error", message: "nope" }), { status: 422 })) as unknown as typeof fetch;
    expect(await sendCongrats(cfg, { id: "abc", to: "x@example.test", subject: "S", body: "B" }, bad)).toMatchObject({ ok: false });
    expect(await sendCongrats({ ...cfg, enabled: false }, { id: "abc", to: "x@example.test", subject: "S", body: "B" }, ok)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
  });
});
