/**
 * Customer update APIs: preview and publish are editor-only, the report is rebuilt on the server (the
 * browser can't inject content), a stale preview is refused, links store only a hash, and the
 * customer link serves nothing once turned off.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SID = "11111111-1111-4111-8111-111111111111";
const EID = "22222222-2222-4222-8222-222222222222";
const PID = "55555555-5555-4555-8555-555555555555";
const T1 = "44444444-4444-4444-8444-444444444441";
const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };

const S = {
  canEdit: true, perms: null as null | Record<string, boolean>, revision: 3, calls: [] as { name: string; args: Record<string, unknown> }[],
  pub: null as null | Record<string, unknown>,
};
const schedule = () => ({
  schedule: { id: SID, estimate_id: EID, company_id: null, name: "Kitchen", status: "active", provisional: false, calendar: CAL, start_date: "2026-11-16", target_end_date: null, progress_method: "duration", revision: S.revision, updated_at: "" },
  snapshot: { estimate: { id: EID, title: "Kitchen", number: "1", customerName: "Pat", projectAddress: null }, trades: [], version: null, sections: [{ id: "g1", name: "Framing", trade: null, sortOrder: 0, items: [] }] },
  tasks: [{ id: T1, parent_id: null, kind: "section", source_group_id: "g1", source_item_id: null, split_from: null, name: "Framing", sort_order: 0, planned_start: "2026-11-16", planned_end: "2026-11-19", duration_days: 4, actual_start: null, actual_finish: null, percent_complete: 25, status: "in_progress", weight: 3, assignee: "Bob", notes: "PRIVATE note" }],
  deps: [], revisions: [], canEdit: S.canEdit, ...(S.perms ? { permissions: S.perms } : {}),
});
const pubRow = (over: Record<string, unknown> = {}) => ({
  id: PID, schedule_id: SID, version: 1, schedule_revision: 3, published_at: "2026-11-16T00:00:00Z", published_by: "u1", publisher_name: "Sam",
  options: {}, content: { v: 1, company: { name: "Acme", phone: null, email: null, website: null }, brand: { logo: false, color: null }, customerName: "Pat", projectTitle: "Kitchen", projectAddress: null, reportDate: "2026-11-16", provisional: false, progress: 25, projectStart: "2026-11-16", forecastFinish: "2026-11-19", previousForecast: null, showTimeline: true, sections: [], notes: null, counts: { completed: 0, current: 1, upcoming: 0 } },
  token_hash: null, link_created_at: null, link_expires_at: null, link_revoked_at: null, view_count: 0, last_viewed_at: null, delivery: [], logo_path: null, ...over,
});
const chain = (table: string) => {
  const filters: Record<string, unknown> = {};
  const c: Record<string, unknown> = {};
  for (const k of ["select", "order", "limit", "neq", "in", "update"]) c[k] = () => c;
  c.eq = (k: string, v: unknown) => { filters[k] = v; return c; };
  const data = () => {
    if (table === "schedule_publications") {
      if (!S.pub) return null;
      if (filters.token_hash && filters.token_hash !== S.pub.token_hash) return null;
      return S.pub;
    }
    if (table === "project_schedules") return { user_id: "u1" };
    if (table === "business_profiles") return { company_name: "Acme", phone: "555", primary_color: "#112233" };
    return null;
  };
  c.maybeSingle = async () => ({ data: data(), error: null });
  c.then = (r: (v: unknown) => void) => r({ data: data() ? [data()] : [], error: null });
  return c;
};
const supabase = {
  from: chain,
  storage: { from: () => ({ download: async () => ({ data: null }), createSignedUrl: async () => ({ data: null }) }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    S.calls.push({ name, args });
    if (name === "schedule_get") return { data: schedule(), error: null };
    if (name === "schedule_publish") { S.pub = pubRow({ content: (args.p as { content: object }).content }); return { data: { id: PID, version: 1 }, error: null }; }
    if (name === "schedule_publication_link") { S.pub = { ...S.pub, token_hash: args.p_token_hash, link_created_at: new Date().toISOString(), link_expires_at: new Date(Date.now() + 864e5).toISOString() }; return { data: null, error: null }; }
    if (name === "schedule_publication_revoke_link") { S.pub = { ...S.pub, link_revoked_at: new Date().toISOString() }; return { data: null, error: null }; }
    return { data: null, error: null };
  },
};
vi.mock("@/lib/supabase/server", () => ({ getUser: async () => ({ id: "u1" }), createClient: async () => supabase, createAdminClient: () => supabase }));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), rateLimit: async () => true, sameOrigin: async () => true }));
process.env.NEXT_PUBLIC_PROJECT_SCHEDULING = "on";

const preview = (await import("@/app/api/schedules/[id]/updates/preview/route")).POST;
const publish = (await import("@/app/api/schedules/[id]/updates/route")).POST;
const action = (await import("@/app/api/schedules/[id]/updates/[pid]/route")).POST;
const sharedPdf = (await import("@/app/api/updates/[token]/pdf/route")).GET;
const req = (body: object) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: SID }) } as never;
const pctx = { params: Promise.resolve({ id: SID, pid: PID }) } as never;

beforeEach(() => { S.canEdit = true; S.perms = null; S.revision = 3; S.calls = []; S.pub = null; });

describe("customer update API", () => {
  it("preview is built on the server and leaves out private fields", async () => {
    const r = await preview(req({ options: {} }), ctx);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.revision).toBe(3);
    expect(b.report).toMatchObject({ progress: 25, company: { name: "Acme" }, customerName: "Pat" });
    expect(JSON.stringify(b)).not.toMatch(/PRIVATE|Bob/);
    expect((await preview(req({ options: { costs: true } }), ctx)).status).toBe(400);
  });

  it("viewers can't preview or publish (403)", async () => {
    S.canEdit = false;
    expect((await preview(req({ options: {} }), ctx)).status).toBe(403);
    expect((await publish(req({ options: {}, baseRevision: 3, confirm: true }), ctx)).status).toBe(403);
    expect(S.calls.some((c) => c.name === "schedule_publish")).toBe(false);
  });

  it("Phase 9: an editor without Publish customer updates can't preview or publish", async () => {
    S.perms = { edit: true, progress: true, dependencies: true, publish: false, pdf: true };
    expect((await preview(req({ options: {} }), ctx)).status).toBe(403);
    expect((await publish(req({ options: {}, baseRevision: 3, confirm: true }), ctx)).status).toBe(403);
    S.perms = { edit: false, progress: false, dependencies: false, publish: true, pdf: false };
    expect((await preview(req({ options: {} }), ctx)).status).toBe(200);
  });

  it("publishing needs explicit confirmation, the previewed revision, and rebuilds content on the server", async () => {
    expect((await publish(req({ options: {}, baseRevision: 3 }), ctx)).status).toBe(400);
    expect((await publish(req({ options: {}, baseRevision: 3, confirm: true, content: { progress: 100 } }), ctx)).status).toBe(400);
    const stale = await publish(req({ options: {}, baseRevision: 2, confirm: true }), ctx);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("stale_revision");
    const r = await publish(req({ options: { notes: "Cabinets Tuesday" }, baseRevision: 3, confirm: true }), ctx);
    expect(r.status).toBe(201);
    const p = S.calls.find((c) => c.name === "schedule_publish")!.args.p as { content: { progress: number; notes: string }; contentHash: string };
    expect(p.content).toMatchObject({ progress: 25, notes: "Cabinets Tuesday" });
    expect(p.contentHash).toBe(createHash("sha256").update(JSON.stringify(p.content)).digest("hex"));
  });

  it("a share link returns the URL once and stores only its hash; revoked links serve nothing", async () => {
    S.pub = pubRow();
    const r = await action(req({ action: "link" }), pctx);
    expect(r.status).toBe(200);
    const { url } = await r.json();
    const token = url.split("/updates/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const call = S.calls.find((c) => c.name === "schedule_publication_link")!;
    expect(call.args.p_token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(call.args)).not.toContain(token);

    const ok = await sharedPdf(new Request("http://localhost"), { params: Promise.resolve({ token }) } as never);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect((await sharedPdf(new Request("http://localhost"), { params: Promise.resolve({ token: "x".repeat(43) }) } as never)).status).toBe(404);

    await action(req({ action: "revoke" }), pctx);
    expect((await sharedPdf(new Request("http://localhost"), { params: Promise.resolve({ token }) } as never)).status).toBe(410);
  });

  it("delivery records only honest methods", async () => {
    S.pub = pubRow();
    expect((await action(req({ action: "delivery", method: "email_draft" }), pctx)).status).toBe(200);
    expect((await action(req({ action: "delivery", method: "delivered" }), pctx)).status).toBe(400);
  });
});
