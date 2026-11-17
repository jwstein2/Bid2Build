/**
 * V6.1: Customers → Communications settings API against the real SQL. Persistence, permissions and
 * the automatic-sending guards behind the Sending mode controls. No email is sent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createUser, dbAvailable, freshDb } from "./harness";
import { pgSupabase } from "./pg-supabase";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const ALL = ["view_communications", "edit_nurture_templates", "enable_customer_nurture", "approve_marketing_outreach", "configure_project_updates", "approve_customer_updates", "enable_auto_project_updates", "view_customer_replies", "manage_opt_outs"];
const state: { userId: string; perms: string[]; admin: unknown } = { userId: "", perms: ALL, admin: null };

vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true }));
vi.mock("@/lib/comms/server", async (orig) => {
  const real = await orig<typeof import("@/lib/comms/server")>();
  return { ...real, requireComm: async () => ({ ok: true, userId: state.userId, access: { accountId: state.userId, kind: "user", pm: true, perms: state.perms }, supabase: state.admin, admin: state.admin }) };
});
const { PUT } = await import("@/app/api/comms/settings/route");
const put = async (body: unknown) => { const r = await PUT(new Request("http://localhost/api/comms/settings", { method: "PUT", body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };

d("Communications settings API (database)", () => {
  const row = async () => (await pool.query("select * from public.comm_settings where account_id = $1", [state.userId])).rows[0];
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_comms_settings"));
    state.admin = pgSupabase(pool);
    state.userId = await createUser(pool, "owner@test.dev");
    delete process.env.COMM_REPLY_DOMAIN;
  });
  beforeEach(() => { state.perms = ALL; });
  afterAll(async () => { await drop?.(); });

  it("saves and persists follow-up frequency, template and sender details", async () => {
    expect((await put({ nurtureMonths: 12 })).status).toBe(200);
    expect((await put({ nurtureSubject: "Checking in on your {project_type} project", nurtureBody: "Hi {first_name}, just checking in. {company_name}" })).status).toBe(200);
    expect((await put({ postalAddress: "1 Main St, Duluth MN", senderName: "Lee Decks", replyTo: "Office@Lee.dev" })).status).toBe(200);
    const r = await row();
    expect(r).toMatchObject({ nurture_months: 12, postal_address: "1 Main St, Duluth MN", sender_name: "Lee Decks", reply_to: "office@lee.dev", template_version: 2 });
    expect(r.nurture_enabled).toBe(false); // changing settings never turns follow-ups on
  });

  it("keeps follow-ups in Review first: automatic is refused without working reply monitoring", async () => {
    expect((await put({ nurtureMode: "automatic" })).body.error.code).toBe("confirm_required");
    const r = await put({ nurtureMode: "automatic", confirmAutomatic: true });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("reply_monitoring_required");
    expect((await row()).nurture_mode).toBe("review");
    expect((await put({ nurtureMode: "review" })).status).toBe(200);
  });

  it("never makes automatic the company default for project updates", async () => {
    const r = await put({ updatesMode: "automatic", confirmAutomatic: true });
    expect(r.body.error.code).toBe("per_project");
    expect((await row()).updates_mode).toBe("review");
    expect((await put({ updatesFrequency: "weekly", updatesWeekday: 2, updatesHour: 9 })).status).toBe(200);
    expect(await row()).toMatchObject({ updates_frequency: "weekly", updates_weekday: 2, updates_hour: 9, updates_mode: "review" });
  });

  it("enforces each permission on the server", async () => {
    state.perms = ["view_communications"];
    for (const body of [{ nurtureMonths: 6 }, { nurtureMode: "review" }, { nurtureSubject: "x", nurtureBody: "y" }, { updatesFrequency: "off" }, { postalAddress: "x" }]) {
      expect((await put(body)).status).toBe(403);
    }
    expect((await row()).nurture_months).toBe(12);
  });

  it("rejects templates that promise an old price and unknown fields", async () => {
    expect((await put({ nurtureSubject: "Your quote is still valid", nurtureBody: "We'll honor your old price." })).body.error.code).toBe("invalid_template");
    expect((await put({ nurtureEnabled: true, sendNow: true })).status).toBe(400);
    expect((await pool.query("select count(*)::int n from public.comm_messages")).rows[0].n).toBe(0);
  });
});
