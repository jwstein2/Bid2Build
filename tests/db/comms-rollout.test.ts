/**
 * V6.10 customer communications rollout, against the real SQL: the customer email terms must be accepted
 * before anything can be activated, approved or sent, and the account owner's switch turns customer emails
 * off for the whole account (queue canceled, writes refused, nothing sent) until the owner turns it back on.
 * A fake Resend records sends; nothing leaves the machine.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createUser, dbAvailable, freshDb } from "./harness";
import { pgSupabase } from "./pg-supabase";
import type { CommConfig } from "@/lib/comms/config";
import { deliverDue, planNurture } from "@/lib/comms/runner";
import { COMM_TERMS_VERSION, TERMS_MESSAGE } from "@/lib/comms/rollout";

process.env.COMM_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret-0123456789";
const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
type Row = Record<string, unknown>;
const ALL = ["view_communications", "edit_nurture_templates", "enable_customer_nurture", "approve_marketing_outreach", "configure_project_updates", "approve_customer_updates", "enable_auto_project_updates", "view_customer_replies", "manage_opt_outs"];
const state: { userId: string; accountId: string; kind: "user" | "company"; perms: string[]; admin: unknown } = { userId: "", accountId: "", kind: "user", perms: ALL, admin: null };

vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true }));
vi.mock("@/lib/comms/server", async (orig) => {
  const real = await orig<typeof import("@/lib/comms/server")>();
  return { ...real, requireComm: async () => ({ ok: true, userId: state.userId, access: { accountId: state.accountId, kind: state.kind, pm: true, perms: state.perms }, supabase: state.admin, admin: state.admin }) };
});
const { PUT: putSettings } = await import("@/app/api/comms/settings/route");
const { POST: postTerms } = await import("@/app/api/comms/terms/route");
const { POST: postSwitch } = await import("@/app/api/comms/company-switch/route");
const { POST: postAudience } = await import("@/app/api/comms/audience/route");
const { POST: postMessage } = await import("@/app/api/comms/messages/[id]/route");
const { PUT: putProject } = await import("@/app/api/comms/projects/[id]/route");
const { POST: postPause } = await import("@/app/api/comms/pause-all/route");

const req = (body: unknown) => new Request("http://localhost/api/comms", { method: "POST", body: JSON.stringify(body) });
const out = async (r: Response) => ({ status: r.status, body: await r.json() });
const msgCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const cfg = (): CommConfig => ({ mode: "live", enabled: true, reason: null, apiKey: "re_test", fromAddress: "updates@built2bid.org", replyDomain: null, webhookSecret: "", inboundSecret: "", testRecipients: [], dailyCap: 300, accountDailyCap: 60 });
const sends: unknown[] = [];

d("Customer communications rollout (database)", () => {
  let owner: string;
  const row = async () => (await pool.query("select * from public.comm_settings where account_id = $1", [owner])).rows[0] as Row;
  const queue = async (status = "awaiting_review", kind = "nurture") => (await pool.query(
    "insert into public.comm_messages (account_id, kind, trigger, to_email, to_name, subject, body_text, status, scheduled_for, idempotency_key) values ($1, $2, $3, 'pat@example.com', 'Pat', 'Hi', 'Body', $4, now() - interval '1 minute', gen_random_uuid()::text) returning id",
    [owner, kind, kind === "nurture" ? "six_month" : "weekly", status])).rows[0].id as string;
  const status = async (id: string) => (await pool.query("select status, status_reason from public.comm_messages where id = $1", [id])).rows[0] as Row;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_comms_rollout"));
    state.admin = pgSupabase(pool);
    owner = await createUser(pool, "owner@test.dev");
    await pool.query("insert into public.business_profiles (user_id, company_name, address) values ($1, 'Lee Decks', '1 Main St, Duluth MN')", [owner]).catch(() => {});
    await pool.query("insert into public.comm_settings (account_id, account_kind, postal_address) values ($1, 'user', '1 Main St, Duluth MN')", [owner]);
  });
  beforeEach(() => { state.userId = owner; state.accountId = owner; state.kind = "user"; state.perms = ALL; });
  afterEach(() => { vi.unstubAllGlobals(); sends.length = 0; });
  afterAll(async () => { await drop?.(); });

  it("refuses activation, approval and project updates until the customer email terms are accepted", async () => {
    expect((await out(await postAudience(req({ emails: ["pat@example.com"], activate: true })))).body.error.code).toBe("terms_required");
    expect((await out(await putSettings(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ nurtureEnabled: true }) })))).body.error.code).toBe("terms_required");
    const id = await queue();
    expect((await out(await postMessage(req({ action: "approve" }), msgCtx(id)))).body.error.code).toBe("terms_required");
    expect((await out(await postMessage(req({ action: "send_now" }), msgCtx(id)))).body.error.code).toBe("terms_required");
    const sid = "00000000-0000-4000-8000-000000000001";
    expect((await out(await putProject(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ frequency: "weekly", mode: "review" }) }), msgCtx(sid)))).body.error.code).toBe("terms_required");
    // Defaults can still be set up beforehand (nothing sends from a default).
    expect((await putSettings(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ nurtureMonths: 6, updatesFrequency: "milestone" }) }))).status).toBe(200);
    // Skipping is always allowed.
    expect((await postMessage(req({ action: "skip" }), msgCtx(id))).status).toBe(200);
  });

  it("holds anything due for review and plans nothing while the terms aren't accepted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { sends.push(1); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }));
    const id = await queue("scheduled");
    await deliverDue(state.admin as never, new Date(), cfg(), false, {}, [id]);
    expect(await status(id)).toMatchObject({ status: "awaiting_review", status_reason: TERMS_MESSAGE });
    await pool.query("update public.comm_settings set nurture_enabled = true, nurture_activated_at = now() where account_id = $1", [owner]);
    const plan: Record<string, number> = {};
    await planNurture(state.admin as never, new Date(), cfg(), false, plan);
    expect(plan.planned ?? 0).toBe(0);
    expect(sends).toHaveLength(0);
    await pool.query("update public.comm_settings set nurture_enabled = false, nurture_activated_at = null where account_id = $1", [owner]);
    await pool.query("delete from public.comm_messages where account_id = $1", [owner]);
  });

  it("only lets someone allowed to turn emails on accept the terms, and records who and which version", async () => {
    state.perms = ["view_communications", "approve_marketing_outreach"];
    expect((await postTerms(req({ accept: true, version: COMM_TERMS_VERSION }))).status).toBe(403);
    state.perms = ALL;
    expect((await out(await postTerms(req({ accept: true, version: COMM_TERMS_VERSION + 1 })))).body.error.code).toBe("terms_changed");
    expect((await postTerms(req({ accept: true, version: COMM_TERMS_VERSION }))).status).toBe(200);
    expect(await row()).toMatchObject({ terms_accepted_by: owner, terms_version: COMM_TERMS_VERSION });
    expect((await pool.query("select count(*)::int n from public.comm_events where account_id = $1 and kind = 'terms_accepted'", [owner])).rows[0].n).toBe(1);
  });

  it("lets only the account owner switch customer emails off for the company", async () => {
    state.kind = "company"; state.accountId = "00000000-0000-4000-8000-0000000000aa"; // a company this user doesn't own
    expect((await out(await postSwitch(req({ off: true, confirm: true })))).body.error.code).toBe("owner_only");
    state.kind = "user"; state.accountId = owner;
    expect((await postSwitch(req({ off: true }))).status).toBe(400); // confirmation required
  });

  it("owner switch off cancels the queue, refuses every write that could send, and stays off until the owner turns it on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { sends.push(1); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }));
    await pool.query("update public.comm_settings set nurture_enabled = true, nurture_activated_at = now(), nurture_activated_by = $1 where account_id = $1", [owner]);
    const waiting = await queue("awaiting_review");
    const scheduled = await queue("approved", "project_update");
    const r = await out(await postSwitch(req({ off: true, confirm: true, reason: "Reviewing our email policy" })));
    expect(r.status).toBe(200);
    expect(await row()).toMatchObject({ disabled_by: owner, disabled_reason: "Reviewing our email policy", nurture_enabled: false, nurture_activated_at: null });
    for (const id of [waiting, scheduled]) expect((await status(id)).status).toBe("canceled");

    // Everything that could lead to an email is refused with 423.
    const put = (b: unknown) => putSettings(new Request("http://localhost", { method: "PUT", body: JSON.stringify(b) }));
    expect((await out(await put({ nurtureMonths: 12 }))).body.error.code).toBe("comms_disabled");
    expect((await out(await postAudience(req({ emails: [], activate: true })))).body.error.code).toBe("comms_disabled");
    expect((await out(await postTerms(req({ accept: true, version: COMM_TERMS_VERSION })))).body.error.code).toBe("comms_disabled");
    expect((await out(await postPause(req({ paused: false })))).body.error.code).toBe("comms_disabled");
    const late = await queue("awaiting_review");
    expect((await out(await postMessage(req({ action: "send_now" }), msgCtx(late)))).body.error.code).toBe("comms_disabled");
    expect((await postMessage(req({ action: "cancel" }), msgCtx(late))).status).toBe(200);
    const sid = "00000000-0000-4000-8000-000000000002";
    expect((await putProject(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ frequency: "weekly", mode: "review" }) }), msgCtx(sid))).status).toBe(423);
    expect((await putProject(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ frequency: "off", mode: "review" }) }), msgCtx(sid))).status).not.toBe(423);

    // A message that slipped into the queue is canceled at send time, never sent.
    const slipped = await queue("approved");
    await deliverDue(state.admin as never, new Date(), cfg(), false, {}, [slipped]);
    expect((await status(slipped)).status).toBe("canceled");
    expect(sends).toHaveLength(0);

    // Back on: nothing restarts by itself.
    expect((await postSwitch(req({ off: false, confirm: true }))).status).toBe(200);
    expect(await row()).toMatchObject({ disabled_at: null, nurture_enabled: false });
    expect((await put({ nurtureMonths: 12 })).status).toBe(200);
    expect((await pool.query("select array_agg(kind order by created_at) k from public.comm_events where account_id = $1 and kind in ('disabled', 'enabled')", [owner])).rows[0].k).toEqual(["disabled", "enabled"]);
  });
});
