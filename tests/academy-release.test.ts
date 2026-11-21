import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, centralToday, lessonSlug, nextPlannedLesson, releaseLabel, slugify } from "@/lib/academy/release-plan";
import { releaseDueCourses, toLessonRow, writeNextLesson, type LessonDraft, type LessonWriter } from "@/lib/academy/release";

/** A tiny in-memory stand-in for the supabase-js query builder (only what release.ts uses). */
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "update" = "select";
    let patch: Row = {};
    const sorts: string[] = [];
    let lim = Infinity;
    const result = () => {
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === "update") { hit.forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
      const sorted = [...hit].sort((a, b) => { for (const k of sorts) { const x = String(a[k] ?? ""), y = String(b[k] ?? ""); if (x !== y) return x < y ? -1 : 1; } return 0; });
      return { data: sorted.slice(0, lim), error: null };
    };
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return b; },
      not: (k: string) => { filters.push((r) => r[k] != null); return b; },
      lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return b; },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return b; },
      order: (k: string) => { sorts.push(k); return b; },
      limit: (n: number) => { lim = n; return b; },
      maybeSingle: async () => { const r = result(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: null }; },
      update: (p: Row) => { mode = "update"; patch = p; return b; },
      insert: async (r: Row) => {
        if (name === "academy_lessons" && rows.some((x) => x.course_id === r.course_id && x.slug === r.slug)) return { error: { code: "23505" } };
        rows.push({ ...r }); return { error: null };
      },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
    };
    return b;
  };
  return { from, rpc: vi.fn() } as unknown as SupabaseClient;
}

const draft = (over: Partial<LessonDraft> = {}): LessonDraft => ({
  summary: "How to price the first phase.", body_md: `# Title to strip\n\n${"A practical paragraph about estimating. ".repeat(60)}`,
  takeaways: ["One", "Two", "Three"], checklist: ["Do a", "Do b", "Do c", "Do d"], estimated_minutes: 9,
  quiz: [{ q: "Which?", options: ["A", "B", "C"], answer: 1, explain: "Because." }, { q: "Bad", options: ["A"], answer: 3, explain: "x" }], ...over,
});

const NOW = new Date("2026-11-23T15:00:00Z"); // Monday 9 AM Central

function catalog() {
  return {
    academy_settings: [{ id: true, auto_release: true, release_per_week: 2, release_weekday: 1 }],
    academy_trades: [{ slug: "roofing", name: "Roofing" }],
    academy_courses: [
      { id: "c1", slug: "roofing-start", title: "Starting a Roofing Business", summary: "s", description: null, trade_slug: "roofing", pillar: "getting_started", level: "beginner", access: "public", planned_lessons: ["Licensing basics", "Insurance"], release_on: "2026-11-23", status: "upcoming", sort_order: 10 },
      { id: "c2", slug: "roofing-sales", title: "Roofing Sales", summary: "s", description: null, trade_slug: "roofing", pillar: "sales", level: "beginner", access: "public", planned_lessons: ["Walk-throughs"], release_on: "2026-11-30", status: "upcoming", sort_order: 20 },
      { id: "c3", slug: "far-away", title: "Far Away", summary: "s", description: null, trade_slug: null, pillar: "hr", level: "beginner", access: "public", planned_lessons: ["Later"], release_on: "2027-03-01", status: "upcoming", sort_order: 30 },
    ] as Row[],
    academy_lessons: [] as Row[],
    academy_audit_log: [] as Row[],
  };
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("release-plan helpers", () => {
  it("uses Central time for today", () => {
    expect(centralToday(new Date("2026-11-30T05:59:00Z"))).toBe("2026-11-29");
    expect(centralToday(new Date("2026-11-30T06:01:00Z"))).toBe("2026-11-30");
  });
  it("adds days and labels dates without shifting them", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(releaseLabel("2026-11-30")).toBe("Nov 30, 2026");
    expect(releaseLabel("2026-11-30", { weekday: true })).toBe("Mon, Nov 30, 2026");
  });
  it("builds unique lesson slugs", () => {
    expect(slugify("Phase Costs, Tie-Ins & Change Orders")).toBe("phase-costs-tie-ins-change-orders");
    expect(lessonSlug("Insurance", ["insurance"])).toBe("insurance-2");
    expect(lessonSlug("A", [])).toMatch(/^[a-z0-9-]{3,}$/);
  });
  it("finds the next planned lesson by title or slug", () => {
    expect(nextPlannedLesson(["Licensing basics", "Insurance"], [{ slug: "licensing-basics", title: "Something else" }])).toEqual({ index: 1, title: "Insurance" });
    expect(nextPlannedLesson(["Licensing basics"], [{ slug: "x", title: "licensing  BASICS" }])).toBeNull();
  });
});

describe("toLessonRow", () => {
  it("cleans a draft into a valid row and drops broken quiz questions", () => {
    const row = toLessonRow(draft(), { courseId: "c1", title: "T", slug: "t-1", sortOrder: 2, access: "public" })!;
    expect(row.body_md.startsWith("# ")).toBe(false);
    expect(row.quiz).toHaveLength(1);
    expect(row.status).toBe("published");
    expect(row.estimated_minutes).toBe(9);
  });
  it("rejects a too-short body", () => {
    expect(toLessonRow(draft({ body_md: "Short." }), { courseId: "c1", title: "T", slug: "t-1", sortOrder: 1, access: "public" })).toBeNull();
  });
});

describe("weekly drip", () => {
  const writer = vi.fn<LessonWriter>(async () => ({ data: draft(), model: "claude-haiku-5-5", inputTokens: 900, outputTokens: 2000, costUsd: 0.0011 }));

  it("writes lessons for the soonest course within two weeks, then releases it on its day", async () => {
    const t = catalog();
    const db = fakeDb(t);
    expect((await releaseDueCourses(db, NOW)).waiting).toEqual([{ slug: "roofing-start", written: 0, planned: 2 }]);
    const a = await writeNextLesson(db, writer, NOW);
    expect(a.wrote).toMatchObject({ course: "roofing-start", lesson: "licensing-basics" });
    const b = await writeNextLesson(db, writer, NOW, { skip: 1 });
    expect(b.wrote).toMatchObject({ course: "roofing-sales" });
    await writeNextLesson(db, writer, NOW);
    expect(t.academy_lessons.map((l) => l.slug).sort()).toEqual(["insurance", "licensing-basics", "walk-throughs"]);
    expect(writer.mock.calls[0][0].user).toContain("Roofing examples throughout");
    const r = await releaseDueCourses(db, NOW);
    expect(r.released).toEqual(["roofing-start"]);
    expect(t.academy_courses.find((c) => c.id === "c1")!.status).toBe("published");
    expect(t.academy_courses.find((c) => c.id === "c2")!.status).toBe("upcoming"); // its day hasn't come
    expect(t.academy_audit_log.map((x) => x.action)).toContain("course.auto_release");
    // Courses beyond the two-week window are left alone.
    expect((await writeNextLesson(db, writer, NOW)).wrote).toBeNull();
    expect(t.academy_lessons.some((l) => l.course_id === "c3")).toBe(false);
  });

  it("does nothing while paused or switched off", async () => {
    const t = catalog();
    t.academy_settings[0].auto_release = false;
    expect((await writeNextLesson(fakeDb(t), writer, NOW)).skipped).toBe("paused");
    expect((await releaseDueCourses(fakeDb(t), NOW)).skipped).toBe("paused");
    vi.stubEnv("ACADEMY_RELEASE_ENABLED", "false");
    expect((await writeNextLesson(fakeDb(catalog()), writer, NOW)).skipped).toBe("disabled");
  });

  it("reports pending work without AI configured", async () => {
    expect(await writeNextLesson(fakeDb(catalog()), null, NOW)).toMatchObject({ wrote: null, skipped: "ai_not_configured", pending: 2 });
  });
});
