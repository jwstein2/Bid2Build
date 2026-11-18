import { describe, expect, it } from "vitest";
import { ACADEMY_TRADES, ALL_COURSES, PLAYBOOK_TRADES, TRADE_COURSES } from "@/lib/academy/content/catalog";
import { RESOURCES } from "@/lib/academy/content/resources";
import { SALES_ACADEMY } from "@/lib/academy/content/sales-academy";
import { trades as appTrades } from "@/lib/trades/catalog";
import { LEVELS, academyErrorMessage, isPillar, levelFor } from "@/lib/academy/types";

describe("academy catalog", () => {
  it("covers every real Built2Bid trade with 6-10 course cards across distinct pillars", () => {
    const real = appTrades.map((t) => t.slug).filter((s) => s !== "other");
    expect(ACADEMY_TRADES.map((t) => t.slug).sort()).toEqual([...real].sort());
    for (const t of ACADEMY_TRADES) {
      const cards = TRADE_COURSES.filter((c) => c.trade === t.slug);
      expect(cards.length, t.slug).toBeGreaterThanOrEqual(6);
      expect(cards.length, t.slug).toBeLessThanOrEqual(10);
      expect(new Set(cards.map((c) => c.pillar)).size, t.slug).toBe(cards.length);
      expect(cards.every((c) => isPillar(c.pillar))).toBe(true);
    }
  });

  it("uses unique slugs and titles, and only publishes courses that have written lessons", () => {
    const slugs = ALL_COURSES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of ALL_COURSES) {
      if (c.status === "published") expect(c.lessons?.length, c.slug).toBeGreaterThan(0);
      else expect(c.plannedLessons.length, c.slug).toBeGreaterThan(0);
    }
    expect(ALL_COURSES.filter((c) => c.status === "published").map((c) => c.slug).sort()).toEqual(
      ["contractor-sales-academy", ...PLAYBOOK_TRADES.map((t) => `${t}-sales`)].sort(),
    );
  });

  it("Sales Academy has the 12 topics, each with takeaways, a checklist and trade notes", () => {
    const lessons = SALES_ACADEMY.lessons ?? [];
    expect(lessons).toHaveLength(12);
    expect(lessons.filter((l) => l.access === "public").length).toBe(3);
    for (const l of lessons) {
      expect(l.body.length, l.slug).toBeGreaterThan(600);
      expect(l.takeaways.length, l.slug).toBeGreaterThanOrEqual(3);
      expect(l.checklist.length, l.slug).toBeGreaterThanOrEqual(3);
      expect(Object.keys(l.tradeNotes ?? {}).length, l.slug).toBeGreaterThanOrEqual(3);
      for (const q of l.quiz ?? []) expect(q.answer).toBeLessThan(q.options.length);
      if (l.action) expect(l.action.href.startsWith("/")).toBe(true);
    }
  });

  it("every resource is a verified, credited link and every reference resolves", () => {
    const keys = new Set(RESOURCES.map((r) => r.key));
    expect(keys.size).toBe(RESOURCES.length);
    for (const r of RESOURCES) {
      expect(r.sourceUrl, r.key).toMatch(/^https:\/\/(www\.)?(youtube\.com|skool\.com)\//);
      expect(r.creatorName.length, r.key).toBeGreaterThan(1);
      expect(r.verifiedAt, r.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.permission, r.key).toBe("link_only");
      if (r.embedAllowed) expect(r.embedId, r.key).toBeTruthy();
      if (r.kind === "youtube") expect(r.sourceUrl).toContain(r.embedId!);
    }
    for (const c of ALL_COURSES) {
      for (const k of c.resources ?? []) expect(keys.has(k), `${c.slug} -> ${k}`).toBe(true);
      for (const l of c.lessons ?? []) for (const r of l.resources ?? []) expect(keys.has(r.key), `${l.slug} -> ${r.key}`).toBe(true);
    }
  });
});

describe("academy levels and messages", () => {
  it("levelFor matches the thresholds used by public.academy_level()", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(9)).toBe(1);
    expect(levelFor(10)).toBe(2);
    expect(levelFor(2499)).toBe(8);
    expect(levelFor(2500)).toBe(9);
    expect(LEVELS.map((l) => l.min)).toEqual([0, 10, 30, 75, 150, 300, 600, 1200, 2500]);
  });
  it("maps database error codes to readable messages and never echoes raw errors", () => {
    expect(academyErrorMessage("ERROR: rate_limited")).toMatch(/very quickly/i);
    expect(academyErrorMessage("own_content")).toMatch(/your own/i);
    expect(academyErrorMessage("some internal pg detail 0x123")).not.toContain("0x123");
  });
});
