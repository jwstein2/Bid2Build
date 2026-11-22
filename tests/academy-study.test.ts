import { describe, expect, it } from "vitest";
import { arrange, validate } from "../scripts/academy/kb/gen-study-seed";
import { ITEMS } from "@/lib/academy/kb/seed/study";
import { type StudyRow, examPool, filterItems, pickQuestions, recommendations, score, sectionQuestion, shuffle } from "@/lib/academy/kb/study";

const row = (i: number, deck: string, extra: Partial<StudyRow> = {}): StudyRow => ({
  id: `id-${i}`, key: `k-${i}`, kind: "question", deck, trades: [], state: null, difficulty: "medium", prompt: `Q${i}`, answer: "a", options: ["a", "b", "c", "d"], correct: 0,
  explanation: null, sectionId: null, citation: null, regulatory: false, ...extra,
});

describe("study bank", () => {
  it("passes validation: verified sections, proof phrases, options, trade slugs", () => {
    expect(validate()).toEqual([]);
  });
  it("shuffles options deterministically and keeps the right answer", () => {
    for (const it of ITEMS.filter((i) => i.o)) {
      const a = arrange(it)!;
      expect(a.options[a.correct]).toBe(it.a);
      expect(arrange(it)).toEqual(a);
    }
    const slots = new Set(ITEMS.filter((i) => i.o).map((i) => arrange(i)!.correct));
    expect(slots.size).toBeGreaterThan(2);
  });
});

describe("study engine", () => {
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => row(i, "a")),
    ...Array.from({ length: 30 }, (_, i) => row(100 + i, "b")),
    ...Array.from({ length: 10 }, (_, i) => row(200 + i, "mn", { state: "MN" })),
  ];
  it("limits state items to the learner's state", () => {
    expect(filterItems(rows, { state: "WI" }, []).some((r) => r.state)).toBe(false);
    expect(filterItems(rows, { state: "MN" }, []).filter((r) => r.state === "MN")).toHaveLength(10);
  });
  it("picks the requested count, spread across topics, without repeats", () => {
    for (const n of [5, 10, 20, 25, 50]) {
      const p = pickQuestions(rows, n, 42);
      expect(p).toHaveLength(n);
      expect(new Set(p.map((r) => r.id)).size).toBe(n);
    }
    const five = pickQuestions(rows.filter((r) => !r.state), 6, 7);
    expect(five.filter((r) => r.deck === "a")).toHaveLength(3);
    expect(pickQuestions(rows, 500, 1)).toHaveLength(70);
  });
  it("puts missed questions first", () => {
    const missed = new Set(["id-3", "id-4"]);
    const p = pickQuestions(rows.filter((r) => r.deck === "a"), 2, 9, missed);
    expect(new Set(p.map((r) => r.id))).toEqual(missed);
  });
  it("scores and recommends the weakest topic", () => {
    const set = [row(1, "a"), row(2, "a"), row(3, "b")];
    const ans = { "id-1": 0, "id-2": 1, "id-3": 1 };
    expect(score(set, ans)).toMatchObject({ right: 1, total: 3, percent: 33 });
    expect(recommendations(set, ans, [{ slug: "b", title: "B", about: "", state: null }])[0]).toMatchObject({ slug: "b", title: "B", missed: 1 });
  });
  it("builds exam pools from the exam's decks and state", () => {
    expect(examPool(rows, { decks: ["a", "mn"], state: null })).toHaveLength(30);
    expect(examPool(rows, { decks: ["a", "mn"], state: "MN" })).toHaveLength(40);
  });
  it("makes find-the-section questions only with enough real citations", () => {
    const reg = Array.from({ length: 4 }, (_, i) => row(i, "a", { regulatory: true, citation: `29 CFR 1926.50${i}` }));
    const q = sectionQuestion(reg[0], reg, 3)!;
    expect(q.options).toHaveLength(4);
    expect(q.options[q.correct]).toBe("29 CFR 1926.500");
    expect(sectionQuestion(reg[0], reg.slice(0, 3), 3)).toBeNull();
  });
  it("shuffle is a stable permutation", () => {
    const xs = [1, 2, 3, 4, 5, 6];
    expect(shuffle(xs, 5)).toEqual(shuffle(xs, 5));
    expect([...shuffle(xs, 5)].sort()).toEqual(xs);
  });
});
