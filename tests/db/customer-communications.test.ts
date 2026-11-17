/**
 * Customer communications V4.6, against the real SQL and the real TypeScript services:
 *   - Tenant isolation: RLS is read-only and per account; nobody can write messages from the browser
 *   - Suppressions are durable; "automatic" project updates need an explicit confirmation
 *   - Nurture: one follow-up per person, review mode never sends without approval, a retry never
 *     double sends, test mode only reaches test addresses, the emergency stop sends nothing
 *   - Replies: a human reply pauses the contact and cancels queued follow-ups; STOP suppresses;
 *     auto-replies change nothing; bounces suppress everywhere; one-click unsubscribe works
 *   - Project updates: weekly drafts wait for review, the PM gets ONE reminder, milestones only after
 *     a manager marks a section complete, and a schedule edit after approval sends it back for review
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";
import { pgSupabase } from "./pg-supabase";
import type { CommConfig } from "@/lib/comms/config";
import { deliverDue, planNurture, planProjectUpdates, runComms, sendReminders } from "@/lib/comms/runner";
import { processInbound } from "@/lib/comms/inbound";
import { unsubscribeByMessage } from "@/lib/comms/unsubscribe";
import { messageAction } from "@/lib/comms/actions";
import { upcomingWeekly } from "@/lib/comms/project-updates";

const COMM_PERMISSIONS = ["view_communications", "edit_nurture_templates", "enable_customer_nurture", "approve_marketing_outreach", "configure_project_updates", "approve_customer_updates", "enable_auto_project_updates", "view_customer_replies", "manage_opt_outs"];
process.env.COMM_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret-0123456789";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
type Row = Record<string, unknown>;
const fails = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);
const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const MONTH = 30 * 86_400_000;

const cfg = (over: Partial<CommConfig> = {}): CommConfig => ({
  mode: "live", enabled: true, reason: null, apiKey: "re_test", fromAddress: "updates@built2bid.org", replyDomain: "reply.built2bid.test",
  webhookSecret: "whsec_test", inboundSecret: "", testRecipients: [], dailyCap: 300, accountDailyCap: 60, ...over,
});

/** Fake Resend: records every send, returns a provider id. Nothing leaves the machine. */
const sends: { to: string[]; subject: string; text: string; headers: Record<string, string>; idem: string; reply_to?: string }[] = [];
function fakeResend() {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    sends.push({ ...b, idem: (init.headers as Record<string, string>)["idempotency-key"] });
    return new Response(JSON.stringify({ id: `re_${sends.length}` }), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

d("Customer communications V4.6 (database)", () => {
  let solo: string, other: string;
  let admin: ReturnType<typeof pgSupabase>;
  const msgs = async (where = "true", args: unknown[] = []) => (await pool.query(`select * from public.comm_messages where ${where} order by created_at`, args)).rows as Row[];
  const sub = (u: string) =>
    pool.query(
      `select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
        p_status => 'active', p_plan => 'monthly', p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
        p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => null, p_seat_quantity => null)`, [u]);
  const setStage = async (id: string, stage: string) => {
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)");
      await c.query("update public.estimates set pipeline_stage = $2 where id = $1", [id, stage]); await c.query("commit");
    } finally { c.release(); }
  };
  async function lostBid(u: string, email: string, name = "Pat Lee") {
    const id = (await pool.query("insert into public.estimates (user_id, title, customer_name, customer_email, trades) values ($1, 'Deck rebuild', $2, $3, '{decking}') returning id", [u, name, email])).rows[0].id as string;
    await setStage(id, "lost");
    return id;
  }
  async function enroll(account: string, email: string) {
    return (await pool.query("insert into public.comm_contacts (account_id, email, name, basis) values ($1, $2, 'Pat Lee', 'inquiry') returning id", [account, email])).rows[0].id as string;
  }
  async function activeSchedule(u: string, email: string) {
    const id = (await pool.query("insert into public.estimates (user_id, title, customer_name, customer_email, trades) values ($1, 'Kitchen', 'Sam Diaz', $2, '{framing}') returning id", [u, email])).rows[0].id as string;
    await setStage(id, "won");
    const g = (await pool.query("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Framing', 0) returning id", [id, u])).rows[0].id as string;
    const p = { name: "Kitchen", calendar: CAL, startDate: "2026-11-16", tasks: [{ key: "a", kind: "section", sourceGroupId: g, name: "Framing", plannedStart: "2026-11-16", plannedEnd: "2026-11-19", durationDays: 4, sortOrder: 0 }], deps: [] };
    const sid = await asUser(pool, u, (q) => q("select public.schedule_create($1, false, $2) as id", [id, p])).then((r) => r.rows[0].id as string);
    await pool.query("update public.project_schedules set status = 'active' where id = $1", [sid]);
    return sid;
  }
  const settings = (account: string, patch: Row) =>
    pool.query(`insert into public.comm_settings (account_id, account_kind, ${Object.keys(patch).join(", ")}) values ($1, 'user', ${Object.keys(patch).map((_, i) => `$${i + 2}`).join(", ")})
      on conflict (account_id) do update set ${Object.keys(patch).map((k) => `${k} = excluded.${k}`).join(", ")}`, [account, ...Object.values(patch)]);
  const access = (u: string) => ({ accountId: u, kind: "user" as const, pm: true, perms: COMM_PERMISSIONS as never });

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_customer_comms"));
    admin = pgSupabase(pool);
    solo = await createUser(pool, "solo@test.dev");
    other = await createUser(pool, "other@test.dev");
    for (const u of [solo, other]) { await sub(u); await pool.query("select public.apply_pm_update('sub_' || $1, true, 0, now())", [u]); }
    await pool.query("insert into public.business_profiles (user_id, company_name, address) values ($1, 'Lee Decks', '1 Main St, Duluth MN')", [solo]).catch(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); sends.length = 0; });
  afterAll(async () => { await drop?.(); });

  it("isolates accounts and keeps message writes server-only", async () => {
    await settings(solo, { postal_address: "1 Main St" });
    await pool.query("insert into public.comm_messages (account_id, kind, trigger, to_email, status, idempotency_key) values ($1, 'nurture', 'manual', 'a@x.dev', 'awaiting_review', 'iso-1')", [solo]);
    const mine = await asUser(pool, solo, (q) => q("select count(*)::int n from public.comm_messages"));
    const theirs = await asUser(pool, other, (q) => q("select count(*)::int n from public.comm_messages"));
    expect(mine.rows[0].n).toBe(1);
    expect(theirs.rows[0].n).toBe(0);
    expect(await fails(asUser(pool, solo, (q) => q("insert into public.comm_messages (account_id, kind, trigger, status, idempotency_key) values ($1, 'nurture', 'manual', 'sent', 'iso-2')", [solo])))).toMatch(/permission denied/);
    expect(await fails(asUser(pool, solo, (q) => q("update public.comm_settings set nurture_enabled = true where account_id = $1", [solo])))).toMatch(/permission denied/);
    const acc = await asUser(pool, solo, (q) => q("select public.comm_access() a")).then((r) => r.rows[0].a);
    expect(acc).toMatchObject({ accountId: solo, kind: "user", pm: true });
    expect(acc.perms).toEqual(expect.arrayContaining(["enable_customer_nurture", "view_customer_replies"]));
  });

  it("keeps suppressions durable and requires explicit confirmation for automatic updates", async () => {
    await pool.query("insert into public.comm_suppressions (account_id, email, scope, reason) values ($1, 'gone@x.dev', 'all', 'unsubscribe')", [solo]);
    expect(await fails(pool.query("delete from public.comm_suppressions where email = 'gone@x.dev'"))).toMatch(/suppression/i);
    expect((await pool.query("select count(*)::int n from public.comm_suppressions where email = 'gone@x.dev'")).rows[0].n).toBe(1);
    const sid = await activeSchedule(solo, "sam@x.dev");
    expect(await fails(pool.query("insert into public.project_comm_settings (schedule_id, account_id, frequency, mode) values ($1, $2, 'weekly', 'automatic')", [sid, solo]))).not.toBe("ok");
    await pool.query("insert into public.project_comm_settings (schedule_id, account_id, frequency, mode) values ($1, $2, 'weekly', 'review')", [sid, solo]);
    expect(await fails(pool.query("update public.project_comm_settings set mode = 'automatic', auto_confirmed_by = $2, auto_confirmed_at = auto_confirmed_at where schedule_id = $1", [sid, solo]))).not.toBe("ok");
    await pool.query("update public.project_comm_settings set mode = 'automatic', auto_confirmed_by = $2, auto_confirmed_at = now() where schedule_id = $1", [sid, solo]);
    await pool.query("delete from public.project_comm_settings where schedule_id = $1", [sid]);
  });

  it("nurture: review mode waits for approval, sends once, never double sends on retry", async () => {
    fakeResend();
    await pool.query("delete from public.comm_messages");
    await lostBid(solo, "pat@x.dev");
    await lostBid(solo, "pat@x.dev"); // a second bid for the same person: still ONE follow-up
    await enroll(solo, "pat@x.dev");
    await settings(solo, { nurture_enabled: true, nurture_activated_at: new Date().toISOString(), nurture_activated_by: solo, postal_address: "1 Main St, Duluth MN", nurture_mode: "review" });
    const later = new Date(Date.now() + 7 * MONTH);
    const out: Record<string, number> = {};
    await planNurture(admin, later, cfg(), false, out, solo);
    await planNurture(admin, later, cfg(), false, out, solo); // idempotent
    let rows = await msgs("kind = 'nurture'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "awaiting_review", to_email: "pat@x.dev" });
    expect(String(rows[0].body_text)).toMatch(/1 Main St, Duluth MN/);
    expect(String(rows[0].body_text)).not.toMatch(/still valid|honor|guarantee/i);
    // Not approved: nothing sends.
    await deliverDue(admin, later, cfg(), false, {});
    expect(sends).toHaveLength(0);
    // Approve -> sends once with idempotency + one-click unsubscribe headers.
    const r = await messageAction(admin, access(solo), solo, String(rows[0].id), "approve");
    expect(r).toMatchObject({ ok: true, status: "approved" });
    await deliverDue(admin, later, cfg(), false, {});
    await deliverDue(admin, later, cfg(), false, {});
    expect(sends).toHaveLength(1);
    expect(sends[0].idem).toBe(`comm/${rows[0].id}`);
    expect(sends[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sends[0].reply_to).toMatch(/^reply\+[0-9a-f]{24}@reply\.built2bid\.test$/);
    rows = await msgs("kind = 'nurture'");
    expect(rows[0].status).toBe("sent");
    expect(rows[0].delivered_at).toBeNull(); // "delivered" only from a provider event
    // Sent content is frozen.
    expect(await fails(pool.query("update public.comm_messages set body_text = 'changed' where id = $1", [rows[0].id]))).not.toBe("ok");
  });

  it("test mode only reaches test addresses and the emergency stop sends nothing", async () => {
    fakeResend();
    await pool.query("insert into public.comm_messages (account_id, kind, trigger, to_email, status, approved_by, idempotency_key, scheduled_for, contact_id) select $1, 'nurture', 'manual', 'pat@x.dev', 'approved', $1, 'tm-1', now() - interval '1 minute', id from public.comm_contacts where email = 'pat@x.dev'", [solo]);
    await deliverDue(admin, new Date(), cfg({ mode: "test", testRecipients: ["qa@built2bid.org"] }), false, {});
    expect(sends).toHaveLength(0);
    expect((await msgs("idempotency_key = 'tm-1'"))[0].status).toBe("skipped");
    await pool.query("insert into public.comm_messages (account_id, kind, trigger, to_email, status, approved_by, idempotency_key, scheduled_for, contact_id) select $1, 'nurture', 'manual', 'pat@x.dev', 'approved', $1, 'stop-1', now() - interval '1 minute', id from public.comm_contacts where email = 'pat@x.dev'", [solo]);
    await pool.query("update public.comm_global set paused = true where id = 1");
    expect(await runComms(admin, { config: cfg() })).toMatchObject({ paused: true });
    await deliverDue(admin, new Date(), cfg(), false, {});
    expect(sends).toHaveLength(0);
    expect((await msgs("idempotency_key = 'stop-1'"))[0].status).toBe("approved");
    await pool.query("update public.comm_global set paused = false where id = 1");
    await pool.query("update public.comm_messages set status = 'canceled' where idempotency_key = 'stop-1'");
  });

  it("a human reply pauses the contact, cancels queued follow-ups and notifies; auto-replies don't", async () => {
    const sent = (await msgs("kind = 'nurture' and status = 'sent'"))[0];
    await pool.query("insert into public.comm_messages (account_id, kind, trigger, to_email, status, idempotency_key, contact_id) values ($1, 'nurture', 'six_month', 'pat@x.dev', 'awaiting_review', 'queued-1', $2)", [solo, sent.contact_id]);
    const to = [`reply+${sent.reply_token}@reply.built2bid.test`];
    const auto = await processInbound(admin, cfg(), { from: "Pat <pat@x.dev>", to, subject: "Automatic reply: Out of office", text: "I am out of the office until Monday.", inReplyTo: null, references: null, providerEventId: "evt-auto" });
    expect(auto.classification).toBe("auto_reply");
    expect((await pool.query("select status from public.comm_contacts where id = $1", [sent.contact_id])).rows[0].status).toBe("eligible");
    const human = await processInbound(admin, cfg(), { from: "Pat <pat@x.dev>", to: ["someone@else.dev"], subject: "Re: Checking in", text: "Thanks! Can you come look at the railing next week?", inReplyTo: String(sent.rfc_message_id), references: null, providerEventId: "evt-human" });
    expect(human).toMatchObject({ matched: true, classification: "human" });
    expect((await pool.query("select status from public.comm_contacts where id = $1", [sent.contact_id])).rows[0].status).toBe("replied");
    expect((await msgs("idempotency_key = 'queued-1'"))[0].status).toBe("canceled");
    expect((await msgs("id = $1", [sent.id]))[0].status).toBe("replied");
    const n = (await pool.query("select * from public.user_notifications where user_id = $1 and kind = 'customer_reply'", [solo])).rows;
    expect(n).toHaveLength(1);
    // The same provider event again is a no-op.
    expect(await processInbound(admin, cfg(), { from: "pat@x.dev", to, subject: "Re", text: "Thanks!", inReplyTo: null, references: null, providerEventId: "evt-human" })).toMatchObject({ duplicate: true });
    // Reply events need the replies permission to read.
    const ev = await asUser(pool, solo, (q) => q("select count(*)::int n from public.comm_events where kind = 'reply'"));
    expect(ev.rows[0].n).toBe(1);
  });

  it("STOP suppresses, bounces suppress everywhere, and one-click unsubscribe works", async () => {
    fakeResend();
    await lostBid(solo, "quinn@x.dev", "Quinn");
    const c = await enroll(solo, "quinn@x.dev");
    const mk = async (key: string, email: string, contact: string | null) => (await pool.query(
      "insert into public.comm_messages (account_id, kind, trigger, to_email, status, idempotency_key, contact_id, rfc_message_id, sent_at) values ($1, 'nurture', 'manual', $2, 'sent', $3, $4, $5, now() - interval '1 day') returning id",
      [solo, email, key, contact, `<${key}@built2bid.test>`])).rows[0].id as string;
    await mk("q-sent", "quinn@x.dev", c);
    const r = await processInbound(admin, cfg(), { from: "quinn@x.dev", to: ["x@y.dev"], subject: "Re: hi", text: "STOP", inReplyTo: "<q-sent@built2bid.test>", references: null, providerEventId: "evt-stop" });
    expect(r.classification).toBe("opt_out");
    expect((await pool.query("select scope, reason from public.comm_suppressions where email = 'quinn@x.dev'")).rows).toEqual([{ scope: "marketing", reason: "stop_request" }]);
    // Bounce: suppressed for every account.
    await mk("b-sent", "bad@x.dev", null);
    await processInbound(admin, cfg(), { from: "MAILER-DAEMON@mx.test", to: ["x@y.dev"], subject: "Undelivered Mail Returned to Sender", text: "Delivery to the following recipient failed permanently: bad@x.dev", inReplyTo: "<b-sent@built2bid.test>", references: null, providerEventId: "evt-bounce" });
    expect((await pool.query("select account_id, scope from public.comm_suppressions where email = 'bad@x.dev'")).rows).toEqual([{ account_id: null, scope: "all" }]);
    // One-click unsubscribe from a message link; queued mail to that address is canceled.
    await lostBid(solo, "ria@x.dev", "Ria");
    const rc = await enroll(solo, "ria@x.dev");
    const rid = await mk("r-sent", "ria@x.dev", rc);
    await pool.query("insert into public.comm_messages (account_id, kind, trigger, to_email, status, approved_by, idempotency_key, contact_id, scheduled_for) values ($1, 'nurture', 'manual', 'ria@x.dev', 'approved', $1, 'r-q', $2, now() - interval '1 minute')", [solo, rc]);
    expect(await unsubscribeByMessage(admin, rid)).toMatchObject({ ok: true });
    expect((await pool.query("select status from public.comm_contacts where id = $1", [rc])).rows[0].status).toBe("unsubscribed");
    expect((await msgs("idempotency_key = 'r-q'"))[0].status).toBe("canceled");
    await deliverDue(admin, new Date(), cfg(), false, {});
    expect(sends.filter((s) => s.to.includes("ria@x.dev") || s.to.includes("quinn@x.dev"))).toHaveLength(0);
  });

  it("project updates: weekly waits for review, ONE PM reminder, and a schedule edit after approval needs re-review", async () => {
    fakeResend();
    await settings(solo, { timezone: "America/Chicago", updates_weekday: 5, updates_hour: 16, paused_at: null });
    const sid = await activeSchedule(solo, "sam@x.dev");
    await pool.query("insert into public.project_comm_settings (schedule_id, account_id, frequency, mode, enabled_at) values ($1, $2, 'weekly', 'review', now())", [sid, solo]);
    const w = upcomingWeekly(new Date(), "America/Chicago", 5, 16);
    const at = new Date(w.createFrom.getTime() + 3_600_000);
    await planProjectUpdates(admin, at, {});
    await planProjectUpdates(admin, at, {});
    let rows = await msgs("schedule_id = $1", [sid]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "awaiting_review", trigger: "weekly", to_email: "sam@x.dev" });
    expect(String(rows[0].body_text)).not.toMatch(/\$|cost|margin|profit/i);
    // Even at send time, unreviewed updates never go out.
    await deliverDue(admin, new Date(w.slot.getTime() + 60_000), cfg(), false, {});
    expect(sends).toHaveLength(0);
    // Day-before reminder to the PM, exactly once.
    const rem = new Date(w.reminderAt.getTime() + 60_000);
    await sendReminders(admin, rem, {});
    await sendReminders(admin, rem, {});
    const notes = (await pool.query("select * from public.user_notifications where kind = 'customer_update' and schedule_id = $1", [sid])).rows;
    expect(notes).toHaveLength(1);
    expect(notes[0].user_id).toBe(solo);
    // Approve, then edit the schedule: it goes back to review instead of sending a stale update.
    await messageAction(admin, access(solo), solo, String(rows[0].id), "approve");
    await pool.query("update public.project_schedules set revision = revision + 1 where id = $1", [sid]);
    await deliverDue(admin, new Date(w.slot.getTime() + 60_000), cfg(), false, {});
    expect(sends).toHaveLength(0);
    expect((await msgs("id = $1", [rows[0].id]))[0].status).toBe("awaiting_review");
    // Re-approve -> sends with a frozen snapshot publication.
    await messageAction(admin, access(solo), solo, String(rows[0].id), "approve");
    await deliverDue(admin, new Date(w.slot.getTime() + 60_000), cfg(), false, {});
    expect(sends).toHaveLength(1);
    rows = await msgs("id = $1", [rows[0].id]);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].publication_id).toBeTruthy();
    expect(sends[0].text).toMatch(/\/updates\//);
  });

  it("milestone updates only after a section is marked complete, and never claim completion otherwise", async () => {
    const sid = await activeSchedule(solo, "mo@x.dev");
    await pool.query("insert into public.project_comm_settings (schedule_id, account_id, frequency, mode, enabled_at) values ($1, $2, 'milestone', 'review', now() - interval '30 days')", [sid, solo]);
    await planProjectUpdates(admin, new Date(), {});
    expect(await msgs("schedule_id = $1", [sid])).toHaveLength(0);
    // 100% recorded but not verified complete: still nothing.
    await pool.query("update public.schedule_tasks set percent_complete = 100 where schedule_id = $1", [sid]);
    await planProjectUpdates(admin, new Date(), {});
    expect(await msgs("schedule_id = $1", [sid])).toHaveLength(0);
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("set local session_replication_role = replica");
      await c.query("update public.schedule_tasks set status = 'complete', actual_finish = current_date where schedule_id = $1", [sid]); await c.query("commit");
    } finally { c.release(); }
    await planProjectUpdates(admin, new Date(), {});
    await planProjectUpdates(admin, new Date(), {});
    const rows = await msgs("schedule_id = $1", [sid]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger: "milestone", status: "awaiting_review" });
    expect(String(rows[0].body_text)).toMatch(/Framing/);
  });
});
