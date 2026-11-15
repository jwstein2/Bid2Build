/**
 * Schedule APIs: dates are rebuilt on the server, viewers can't edit, stale revisions are refused,
 * sections can't be deleted or moved between sections, and every save carries the changed tasks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const SID = "11111111-1111-4111-8111-111111111111";
const EID = "22222222-2222-4222-8222-222222222222";
const G1 = "33333333-3333-4333-8333-333333333331", G2 = "33333333-3333-4333-8333-333333333332";
const T1 = "44444444-4444-4444-8444-444444444441", T2 = "44444444-4444-4444-8444-444444444442";
const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const row = (id: string, g: string, name: string, s: string, e: string, d: number) => ({
  id, parent_id: null, kind: "section", source_group_id: g, source_item_id: null, split_from: null, name, sort_order: 0,
  planned_start: s, planned_end: e, duration_days: d, actual_start: null, actual_finish: null, percent_complete: 0, status: "not_started", weight: null, assignee: null, notes: null,
});

const S = {
  canEdit: true,
  revision: 3,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  rpcError: null as null | { message: string; details?: string },
  perms: null as null | Record<string, boolean>,
};
const schedule = () => ({
  schedule: { id: SID, estimate_id: EID, company_id: null, name: "Kitchen", status: "draft", provisional: false, calendar: CAL, start_date: "2026-11-16", target_end_date: null, progress_method: "duration", revision: S.revision, updated_at: "2026-11-15T00:00:00Z" },
  snapshot: { estimate: { id: EID, title: "Kitchen", number: "1", customerName: "Pat", projectAddress: null }, trades: [], version: null, sections: [] },
  tasks: [row(T1, G1, "Framing", "2026-11-16", "2026-11-19", 4), row(T2, G2, "Flooring", "2026-11-20", "2026-11-24", 3)],
  deps: [{ predecessor_id: T1, successor_id: T2, lag_days: 0, max_overlap: 0 }],
  revisions: [], canEdit: S.canEdit, ...(S.perms ? { permissions: S.perms } : {}),
});
const chain = (data: unknown) => {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit", "neq", "in"]) c[k] = () => c;
  c.maybeSingle = async () => ({ data, error: null });
  c.then = (r: (v: unknown) => void) => r({ data, error: null });
  return c;
};
const supabase = {
  from: (t: string) => chain(t === "estimates" ? { id: EID, title: "Kitchen", pipeline_stage: "won" } : t === "estimate_groups" ? [{ id: G1, name: "Framing", sort_order: 0 }, { id: G2, name: "Flooring", sort_order: 1 }] : null),
  rpc: async (name: string, args: Record<string, unknown>) => {
    S.calls.push({ name, args });
    if (name === "schedule_get") return { data: schedule(), error: null };
    if ((name === "schedule_save" || name === "schedule_create") && S.rpcError) return { data: null, error: S.rpcError };
    if (name === "schedule_save") return { data: S.revision + 1, error: null };
    if (name === "schedule_create") return { data: SID, error: null };
    return { data: null, error: null };
  },
};
vi.mock("@/lib/supabase/server", () => ({ getUser: async () => ({ id: "u1" }), createClient: async () => supabase }));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), rateLimit: async () => true, sameOrigin: async () => true }));
process.env.NEXT_PUBLIC_PROJECT_SCHEDULING = "on";

const { PATCH } = await import("@/app/api/schedules/[id]/route");
const { POST } = await import("@/app/api/schedules/route");
const camel = (r: ReturnType<typeof row>) => ({
  id: r.id, parentId: null, kind: "section" as const, sourceGroupId: r.source_group_id, sourceItemId: null, splitFrom: null, name: r.name, sortOrder: 0,
  plannedStart: r.planned_start, plannedEnd: r.planned_end, durationDays: r.duration_days, actualStart: null, actualFinish: null, percentComplete: 0, status: "not_started" as const, weight: null, assignee: null, notes: null,
});
const base = () => schedule().tasks.map(camel);
const deps = [{ from: T1, to: T2, lagDays: 0, maxOverlap: 0 }];
const patch = (body: object) => PATCH(new Request(`http://localhost/api/schedules/${SID}`, { method: "PATCH", body: JSON.stringify({ baseRevision: S.revision, summary: "Edit", tasks: base(), deps, ...body }) }), { params: Promise.resolve({ id: SID }) } as never);
const saved = () => S.calls.find((c) => c.name === "schedule_save")?.args;

beforeEach(() => { S.canEdit = true; S.revision = 3; S.calls = []; S.rpcError = null; S.perms = null; });

describe("schedule save API", () => {
  it("Phase 9: progress, dates and dependencies each need their own permission", async () => {
    S.perms = { edit: false, progress: true, dependencies: false, publish: false, pdf: true };
    const dated = base(); dated[0] = { ...dated[0], plannedEnd: "2026-11-23" };
    let r = await patch({ tasks: dated });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("forbidden_edit");
    const prog = base(); prog[0] = { ...prog[0], status: "in_progress", percentComplete: 30, actualStart: "2026-11-16" } as never;
    expect((await patch({ tasks: prog })).status).toBe(200);
    r = await patch({ deps: [] });
    expect((await r.json()).error.code).toBe("forbidden_dependencies");
    S.perms = { edit: true, progress: false, dependencies: true, publish: false, pdf: true };
    S.calls = [];
    r = await patch({ tasks: prog });
    expect((await r.json()).error.code).toBe("forbidden_progress");
    expect(saved()).toBeUndefined();
    expect((await patch({ deps: [] })).status).toBe(200);
  });

  it("saves only changed tasks, recomputes duration and records the date change", async () => {
    const t = base(); t[0] = { ...t[0], plannedEnd: "2026-11-23", durationDays: 99 };
    const r = await patch({ tasks: t });
    expect(r.status).toBe(200);
    const p = saved()!.p as { tasks: { id: string; durationDays: number }[]; changes: { id: string }[]; deps?: unknown };
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0]).toMatchObject({ id: T1, durationDays: 6 });
    expect(p.changes.map((c) => c.id)).toEqual([T1]);
    expect(p.deps).toBeUndefined();
  });
  it("viewers can't edit (403) and nothing is saved", async () => {
    S.canEdit = false;
    expect((await patch({})).status).toBe(403);
    expect(saved()).toBeUndefined();
  });
  it("refuses a stale revision", async () => {
    const r = await PATCH(new Request(`http://localhost/api/schedules/${SID}`, { method: "PATCH", body: JSON.stringify({ baseRevision: 2, summary: "x", tasks: base(), deps }) }), { params: Promise.resolve({ id: SID }) } as never);
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("stale_revision");
  });
  it("refuses dependency loops, deleted sections and moving a task to another section", async () => {
    expect((await patch({ deps: [...deps, { from: T2, to: T1, lagDays: 0, maxOverlap: 0 }] })).status).toBe(400);
    expect((await patch({ tasks: [base()[0]], deps: [] })).status).toBe(400);
    const t = base(); t[1] = { ...t[1], sourceGroupId: G1 };
    expect((await patch({ tasks: t })).status).toBe(400);
    expect(saved()).toBeUndefined();
  });
  it("complete needs an actual finish; it's checked on the server", async () => {
    const t = base(); t[0] = { ...t[0], status: "complete" as never };
    const r = await patch({ tasks: t });
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toMatch(/actual finish/);
  });
  it("new line item tasks are sent as new rows with a key", async () => {
    const t = [...base(), { ...camel(row("new-abc", G1, "Wall framing", "2026-11-16", "2026-11-17", 2)), kind: "item" as const, parentId: T1, sourceItemId: "55555555-5555-4555-8555-555555555555" }];
    expect((await patch({ tasks: t })).status).toBe(200);
    const p = saved()!.p as { tasks: { id?: string; key?: string }[] };
    expect(p.tasks[0]).toMatchObject({ key: "new-abc" });
    expect(p.tasks[0].id).toBeUndefined();
  });
});

describe("schedule create API", () => {
  const create = (body: object) => POST(new Request("http://localhost/api/schedules", { method: "POST", body: JSON.stringify({
    estimateId: EID, calendar: CAL, startDate: "2026-11-14", sections: [{ sourceGroupId: G1, durationDays: 4, sortOrder: 0 }, { sourceGroupId: G2, durationDays: 3, sortOrder: 1 }],
    deps: [{ from: G1, to: G2, lagDays: -1, maxOverlap: 1 }], ...body,
  }) }));
  it("rebuilds the dates on the server (weekend start snaps to Monday, overlap applied)", async () => {
    const r = await create({});
    expect(r.status).toBe(201);
    const p = S.calls.find((c) => c.name === "schedule_create")!.args.p as { startDate: string; tasks: { plannedStart: string; plannedEnd: string }[] };
    expect(p.startDate).toBe("2026-11-16");
    expect(p.tasks.map((t) => [t.plannedStart, t.plannedEnd])).toEqual([["2026-11-16", "2026-11-19"], ["2026-11-19", "2026-11-23"]]);
    expect(S.calls.some((c) => c.name === "set_estimate_stage" && c.args.p_stage === "scheduled")).toBe(true);
  });
  it("refuses sections that aren't on the bid and dependency loops", async () => {
    expect((await create({ sections: [{ sourceGroupId: "66666666-6666-4666-8666-666666666666", durationDays: 1, sortOrder: 0 }], deps: [] })).status).toBe(400);
    expect((await create({ deps: [{ from: G1, to: G2, lagDays: 0, maxOverlap: 0 }, { from: G2, to: G1, lagDays: 0, maxOverlap: 0 }] })).status).toBe(400);
  });
  it("an existing schedule is reported with its id (no duplicates)", async () => {
    S.rpcError = { message: "schedule_exists", details: SID };
    const r = await create({});
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatchObject({ code: "schedule_exists", scheduleId: SID });
  });
});
