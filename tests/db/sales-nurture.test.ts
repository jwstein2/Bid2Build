import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb, type Row } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
const q1 = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
const val = async (sql: string, params: unknown[] = []) => Object.values(await q1(sql, params))[0];
const rpc = async (user: string, sql: string, params: unknown[] = []) => Object.values((await asUser(pool, user, (q) => q(sql, params))).rows[0])[0];

const BODY = "Hi Dana,\n\nThanks for taking my call today! Here's your link to get started.\n\nRita";

d("sales follow-up and nurture campaigns (database)", () => {
  let owner: string, ritaU: string, samU: string, rita: string;
  const lead = async (user: string, company: string, email: string, extra: Record<string, unknown> = {}) =>
    ((await rpc(user, "select public.sales_crm_lead_create($1::jsonb)", [JSON.stringify({ company_name: company, email, state: "MN", phone: `612555${Math.floor(1000 + Math.random() * 8999)}`, ...extra })])) as { lead: { id: string } }).lead.id;
  const start = (user: string, id: string, kind: string, subject = "Great speaking with you today — Built2Bid", body = BODY) =>
    rpc(user, "select public.sales_campaign_start($1, $2, $3, $4)", [id, kind, subject, body]) as Promise<{ campaign_id: string; message_id: string }>;
  const markSent = (msg: string, at: string, extra: Record<string, unknown> = {}) =>
    pool.query("select public.sales_campaign_mark($1, 'sent', $2::jsonb, $3)", [msg, JSON.stringify({ provider_id: `re_${msg.slice(0, 8)}_${Math.random()}`, rfc_message_id: `<x-${Math.random()}@built2bid.org>`, ...extra }), at]);
  const campaign = (id: string) => q1("select * from public.sales_campaigns where id = $1", [id]);
  const enable = (p: Record<string, unknown>) => pool.query("select public.admin_sales_nurture_save($1, $2::jsonb)", [owner, JSON.stringify(p)]);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sales_nurture"));
    owner = await createUser(pool, "owner@built2bid.org");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [owner]);
    const member = async (email: string, name: string) =>
      (await q1("select public.admin_sales_member_save($1, null, $2, $3, null, 'rep', 'active', null, true) r", [owner, email, name])).r.id as string;
    rita = await member("rita@sales.com", "Rita Rep");
    await member("sam@sales.com", "Sam Seller");
    ritaU = await createUser(pool, "rita@sales.com");
    samU = await createUser(pool, "sam@sales.com");
    for (const u of [ritaU, samU]) await asUser(pool, u, (q) => q("select public.sales_me()"));
  });
  afterAll(async () => { await drop?.(); });

  it("is off by default: nothing can start until an admin turns it on and approves", async () => {
    const id = await lead(ritaU, "Off Roofing", "dana@offroof.test");
    const s = await rpc(ritaU, "select public.sales_campaign_lead($1)", [id]) as Row;
    expect(s).toMatchObject({ enabled: false, send_mode: "off" });
    expect(s.blockers).toEqual(expect.arrayContaining(["feature_off", "sending_off", "templates_not_approved"]));
    expect(s.can_start.answered).toBe("not_ready");
    await expect(start(ritaU, id, "answered")).rejects.toThrow(/not_ready/);
    // Live needs the platform owner, approved templates, postal address and an explicit confirmation.
    await expect(enable({ send_mode: "live" })).rejects.toThrow(/templates_not_approved/);
    await expect(enable({ send_mode: "live", approve_templates: true, postal_address: "123 Main St, Rochester, MN 55901" })).rejects.toThrow(/confirm_live/);
    await enable({ enabled: true, send_mode: "test", test_recipients: ["dana@summit.test", "pat@deck.test", "lee@nurture.test", "dup@shared.test", "Kim@Paid.test", "bounce@bad.test", "opt@out.test"], approve_templates: true, postal_address: "123 Main St, Rochester, MN 55901" });
    expect(await val("select send_mode from public.sales_nurture_settings")).toBe("test");
    // No @built2bid.org mailbox assigned to the rep yet: off for that rep.
    expect(((await rpc(ritaU, "select public.sales_campaign_lead($1)", [id])) as Row).can_start).toEqual({ answered: "no_sender", no_answer: "no_sender" });
    await expect(start(ritaU, id, "answered")).rejects.toThrow(/no_sender/);
    await expect(pool.query("select public.admin_sales_rep_sender($1, $2, 'rita@gmail.com')", [owner, rita])).rejects.toThrow(/not_built2bid_address/);
    await expect(pool.query("update public.sales_reps set nurture_from_email = 'rita@gmail.com' where id = $1", [rita])).rejects.toThrow(/check/);
    await pool.query("select public.admin_sales_rep_sender($1, $2, 'Rita@Built2Bid.org')", [owner, rita]);
    const sam = (await q1("select id from public.sales_reps where email = 'sam@sales.com'")).id as string;
    await expect(pool.query("select public.admin_sales_rep_sender($1, $2, 'rita@built2bid.org')", [owner, sam])).rejects.toThrow(/address_in_use/);
    await pool.query("select public.admin_sales_rep_sender($1, $2, 'sam@built2bid.org')", [owner, sam]);
    expect(((await rpc(ritaU, "select public.sales_campaign_lead($1)", [id])) as Row).rep.from_email).toBe("rita@built2bid.org");
    // Test mode: only listed addresses.
    await expect(start(ritaU, id, "answered")).rejects.toThrow(/not_test_recipient/);
  });

  it("answered call: first email, then two follow-ups chosen at send time, then complete", async () => {
    const id = await lead(ritaU, "Summit Roofing", "dana@summit.test");
    const s = await rpc(ritaU, "select public.sales_campaign_lead($1)", [id]) as Row;
    expect(s.can_start).toEqual({ answered: "ok", no_answer: "ok" });
    expect(s.milestones).toMatchObject({ top: "none", linked: false });
    await expect(start(ritaU, id, "answered", "Hi {{first_name}}")).rejects.toThrow(/unfilled_placeholder/);
    await expect(start(samU, id, "answered")).rejects.toThrow(/not_found/); // another rep's lead
    const c = await start(ritaU, id, "answered");
    await expect(start(ritaU, id, "answered")).rejects.toThrow(/already_active/);
    await expect(start(ritaU, id, "no_answer")).rejects.toThrow(/already_active/);
    // Monday 2026-11-23 10:00 CT.
    await markSent(c.message_id, "2026-11-23T16:00:00Z");
    const after = await campaign(c.campaign_id);
    expect(after).toMatchObject({ status: "active", steps_sent: 1 });
    // Day 3 = Thursday 10:00 CT (same time of day, inside the lead's window).
    expect((after.next_send_at as Date).toISOString()).toBe("2026-11-26T16:00:00.000Z");
    expect(await val("select count(*)::int from public.sales_activities where lead_id = $1 and kind = 'email' and disposition = 'sent' and evidence = 'system'", [id])).toBe(1);
    expect(await val("select stage from public.sales_leads where id = $1", [id])).toBe("contacted");

    // Nothing is due early; the scheduler claims it once due.
    expect(((await val("select public.sales_campaign_claim('2026-11-25T15:00:00Z', 10)")) as Row).messages).toHaveLength(0);
    // Early in the window the follow-up isn't due yet; at 10:05 CT it is.
    expect(((await val("select public.sales_campaign_claim('2026-11-26T15:05:00Z', 10)")) as Row).messages).toHaveLength(0);
    const claim = (await val("select public.sales_campaign_claim('2026-11-26T16:05:00Z', 10)")) as Row;
    expect(claim.messages).toHaveLength(1);
    const ctx = claim.messages[0];
    expect(ctx).toMatchObject({ message: { step: 1 }, campaign: { kind: "answered", to_email: "dana@summit.test" }, milestones: { match: "none", top: "none" }, suppressed: null, rep: { full_name: "Rita Rep" } });
    expect(ctx.lead).not.toHaveProperty("notes");
    // A second worker gets nothing (claimed + locked).
    expect(((await val("select public.sales_campaign_claim('2026-11-26T16:05:00Z', 10)")) as Row).messages).toHaveLength(0);
    await markSent(ctx.message.id, "2026-11-26T16:06:00Z", { subject: "Any questions about Built2Bid?", body: "x", template_key: "answered_d3_none", milestone: "none" });
    expect((await campaign(c.campaign_id)).steps_sent).toBe(2);
    // Day 7 from the first email = Monday 11-30 at 10:00 CT (inside the window).
    expect(((await campaign(c.campaign_id)).next_send_at as Date).toISOString()).toBe("2026-11-30T16:00:00.000Z");
    const c2 = (await val("select public.sales_campaign_claim('2026-11-30T16:00:00Z', 10)")) as Row;
    await markSent(c2.messages[0].message.id, "2026-11-30T16:01:00Z");
    expect(await campaign(c.campaign_id)).toMatchObject({ status: "completed", steps_sent: 3, end_reason: "All emails sent" });
    expect(await val("select count(*)::int from public.sales_campaign_messages where campaign_id = $1", [c.campaign_id])).toBe(3); // max two follow-ups
    // Completed sequences never restart.
    await expect(start(ritaU, id, "answered")).rejects.toThrow(/already_ran/);
    await expect(start(ritaU, id, "no_answer")).rejects.toThrow(/already_ran/);
  });

  it("no answer → nurture; a later answered call stops it and starts the follow-up (never both)", async () => {
    const id = await lead(ritaU, "Pat's Decks", "pat@deck.test");
    const n = await start(ritaU, id, "no_answer", "Quick question about Pat's Decks");
    await markSent(n.message_id, "2026-11-23T16:00:00Z");
    const s = await rpc(ritaU, "select public.sales_campaign_lead($1)", [id]) as Row;
    expect(s.can_start).toEqual({ answered: "ok", no_answer: "already_active" });
    const a = await start(ritaU, id, "answered");
    expect(await campaign(n.campaign_id)).toMatchObject({ status: "stopped" });
    expect(await val("select count(*)::int from public.sales_campaign_messages where campaign_id = $1 and status = 'scheduled'", [n.campaign_id])).toBe(0);
    expect(await val("select count(*)::int from public.sales_campaigns where lead_id = $1 and status in ('active', 'paused')", [id])).toBe(1);
    expect((await campaign(a.campaign_id)).kind).toBe("answered");
  });

  it("stops on reply, meeting booked, not interested, opt-out, paid conversion and bounce", async () => {
    const mk = async (company: string, email: string) => {
      const id = await lead(ritaU, company, email);
      const c = await start(ritaU, id, "no_answer", `Quick question about ${company}`);
      await markSent(c.message_id, "2026-11-23T16:00:00Z");
      return { id, c: c.campaign_id };
    };
    // Reply logged by the rep.
    let x = await mk("Reply Co", "lee@nurture.test");
    await rpc(ritaU, "select public.sales_crm_activity_log($1, 'reply', 'They wrote back asking for pricing', null)", [x.id]);
    expect(await campaign(x.c)).toMatchObject({ status: "replied" });
    expect(await val("select count(*)::int from public.sales_campaign_messages where campaign_id = $1 and status = 'scheduled'", [x.c])).toBe(0);

    // Booking through the rep's page from the lead's address.
    x = await mk("Shared Co", "dup@shared.test");
    await rpc(ritaU, "select public.sales_my_calendar_settings_save('America/Chicago', 'rita', true, 30, 0, 0, 14, '[{\"d\":1,\"s\":\"09:00\",\"e\":\"17:00\"},{\"d\":2,\"s\":\"09:00\",\"e\":\"17:00\"},{\"d\":3,\"s\":\"09:00\",\"e\":\"17:00\"},{\"d\":4,\"s\":\"09:00\",\"e\":\"17:00\"},{\"d\":5,\"s\":\"09:00\",\"e\":\"17:00\"}]', null)");
    const slot = (await q1("select starts_at from public.sales_booking_slots('rita', now(), '[]') limit 1")).starts_at as Date;
    await pool.query("select public.sales_booking_create('rita', 'intro', $1, 'Shared Person', 'dup@shared.test', 'Shared Co', null, 'tok-intro', '[]', now())", [slot.toISOString()]);
    expect(await campaign(x.c)).toMatchObject({ status: "meeting_scheduled" });
    expect(await val("select count(*)::int from public.sales_activities where lead_id = $1 and kind = 'meeting' and disposition = 'scheduled'", [x.id])).toBe(1);

    // Opt-out link.
    x = await mk("Opt Co", "opt@out.test");
    expect(await val("select public.sales_nurture_unsubscribe('OPT@out.test')")).toBe(1);
    expect(await campaign(x.c)).toMatchObject({ status: "unsubscribed" });
    expect(await val("select public.sales_nurture_suppressed('opt@out.test')")).toBe("opted_out");
    expect(((await rpc(ritaU, "select public.sales_campaign_lead($1)", [x.id])) as Row).can_start.answered).toBe("opted_out");

    // Provider bounce.
    x = await mk("Bounce Co", "bounce@bad.test");
    const pid = (await q1("select provider_message_id from public.sales_campaign_messages where campaign_id = $1 and step = 0", [x.c])).provider_message_id;
    expect(await val("select public.sales_campaign_delivery($1, 'bounced')", [pid])).toBe(true);
    expect(await campaign(x.c)).toMatchObject({ status: "failed_delivery" });
    expect(await val("select email_status from public.sales_leads where id = $1", [x.id])).toBe("bounced");
  });

  it("uses only linked-account activity, and a paid customer ends prospecting", async () => {
    const id = await lead(ritaU, "Kim Paid Builders", "kim@paid.test");
    const c = await start(ritaU, id, "answered");
    await markSent(c.message_id, "2026-11-23T16:00:00Z");
    // Signs up through Rita's link: attribution links the lead.
    const kim = await createUser(pool, "kim@paid.test");
    await pool.query("insert into public.sales_attributions (user_id, rep_id, source, code) values ($1, $2, 'link', (select code from public.sales_reps where id = $2))", [kim, rita]);
    expect(await val("select customer_user_id from public.sales_leads where id = $1", [id])).toBe(kim);
    expect(await val("select public.sales_lead_milestones($1)", [id])).toMatchObject({ match: "linked", top: "account_created" });
    await pool.query("insert into public.estimates (user_id, title) values ($1, 'Kitchen')", [kim]);
    expect(await val("select public.sales_lead_milestones($1)", [id])).toMatchObject({ top: "estimate_started", estimate_completed: false });
    await pool.query("update public.estimates set status = 'finalized' where user_id = $1", [kim]);
    expect(await val("select public.sales_lead_milestones($1)", [id])).toMatchObject({ top: "estimate_completed", estimate_started: true });
    // Rep sees milestone names only.
    const panel = await rpc(ritaU, "select public.sales_campaign_lead($1)", [id]) as Row;
    expect(Object.keys(panel.milestones).sort()).toEqual(["account", "estimate_completed", "estimate_started", "linked", "paid", "proposal_approved", "proposal_sent", "top"]);
    // First payment: lead becomes paying → converted.
    await pool.query("update public.sales_attributions set first_paid_at = now() where user_id = $1", [kim]);
    expect(await campaign(c.campaign_id)).toMatchObject({ status: "converted" });
    expect(await val("select count(*)::int from public.sales_attributions where user_id = $1 and rep_id = $2", [kim, rita])).toBe(1); // attribution untouched

    // An account found only by email (not linked): no activity details.
    const other = await lead(ritaU, "Unlinked Co", "unlinked@acct.test");
    await createUser(pool, "unlinked@acct.test");
    expect(await val("select public.sales_lead_milestones($1)", [other])).toMatchObject({ match: "email_account", top: "account_exists", estimate_started: false });
  });

  it("one live campaign per address across reps, pause/resume/stop, limits and admin pause", async () => {
    const a = await lead(ritaU, "Twin A", "twin@shared2.test");
    // The CRM already blocks a second lead with the same email; a legacy duplicate is inserted directly.
    const b = (await q1("insert into public.sales_leads (company_name, email, state, assigned_rep) values ('Twin B Different', 'twin@shared2.test', 'MN', (select id from public.sales_reps where email = 'sam@sales.com')) returning id")).id as string;
    await enable({ send_mode: "test", test_recipients: ["twin@shared2.test"] });
    const c = await start(ritaU, a, "no_answer", "Quick question about Twin A");
    expect(((await rpc(samU, "select public.sales_campaign_lead($1)", [b])) as Row).can_start.answered).toBe("other_campaign");
    await expect(start(samU, b, "answered")).rejects.toThrow(/other_campaign/);
    await markSent(c.message_id, "2026-11-23T16:00:00Z");
    await rpc(ritaU, "select public.sales_campaign_control($1, 'pause')", [c.campaign_id]);
    const mine = async (at: string) => (((await val("select public.sales_campaign_claim($1, 50)", [at])) as Row).messages as Row[]).filter((x) => x.campaign.id === c.campaign_id);
    expect(await mine("2026-11-27T16:00:00Z")).toHaveLength(0); // paused campaign not claimed
    await expect(asUser(pool, samU, (q) => q("select public.sales_campaign_control($1, 'stop')", [c.campaign_id]))).rejects.toThrow(/not_found/);
    await rpc(ritaU, "select public.sales_campaign_control($1, 'resume')", [c.campaign_id]);
    // Global pause blocks the scheduler.
    await enable({ send_mode: "test", paused: true });
    expect(((await val("select public.sales_campaign_claim('2026-11-27T16:00:00Z', 10)")) as Row)).toMatchObject({ blocked: true, paused: true });
    await enable({ send_mode: "test", paused: false });
    await pool.query("select public.admin_sales_campaign_control($1, $2, 'stop')", [owner, c.campaign_id]);
    expect(await campaign(c.campaign_id)).toMatchObject({ status: "stopped" });
    expect(await val("select count(*)::int from public.sales_campaign_events where campaign_id = $1 and kind in ('paused', 'resumed', 'ended')", [c.campaign_id])).toBe(3);
    // Not interested stops a live campaign; rep stats count real outcomes only.
    const ni = await lead(ritaU, "Lost Co", "twin@shared2.test".replace("twin", "lost"));
    await enable({ send_mode: "test", test_recipients: ["lost@shared2.test"] });
    const c3 = await start(ritaU, ni, "answered");
    await rpc(ritaU, "select public.sales_crm_lead_update($1, $2::jsonb)", [ni, JSON.stringify({ stage: "lost", lost_reason: "Not interested" })]);
    expect(await campaign(c3.campaign_id)).toMatchObject({ status: "not_interested" });
    const stats = await rpc(ritaU, "select public.sales_my_campaign_stats(90)") as Row;
    expect(stats).toMatchObject({ enabled: true, replied: 1, meetings: 1, converted: 1, completed: 1, unsubscribed: 1, failed: 1 });
    expect(stats.accounts_created).toBeGreaterThanOrEqual(1);
    // Reps can't read the tables or call scheduler/admin functions.
    await expect(asUser(pool, ritaU, (q) => q("select * from public.sales_campaigns"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, ritaU, (q) => q("select public.sales_campaign_claim(now(), 5)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, ritaU, (q) => q("select public.admin_sales_nurture($1)", [owner]))).rejects.toThrow(/permission denied/);
    await expect(pool.query("select public.admin_sales_nurture($1)", [ritaU])).rejects.toThrow(/not_authorized/);
    const admin = (await val("select public.admin_sales_nurture($1)", [owner])) as Row;
    expect(admin.team.emails_sent).toBeGreaterThan(5);
    expect(admin.events.length).toBeGreaterThan(5);
  });

  it("retries temporary failures, gives up after three tries, and never double-sends", async () => {
    const id = await lead(ritaU, "Retry Co", "retry@x.test");
    await enable({ send_mode: "test", test_recipients: ["retry@x.test"] });
    const c = await start(ritaU, id, "no_answer", "Quick question about Retry Co");
    await markSent(c.message_id, "2026-11-23T16:00:00Z");
    await markSent(c.message_id, "2026-11-23T16:00:00Z"); // duplicate mark is a no-op
    expect((await campaign(c.campaign_id)).steps_sent).toBe(1);
    let at = new Date("2026-11-26T16:00:00Z");
    for (let i = 0; i < 3; i++) {
      const m = (((await val("select public.sales_campaign_claim($1, 50)", [at.toISOString()])) as Row).messages as Row[]).filter((x) => x.campaign.id === c.campaign_id);
      expect(m).toHaveLength(1);
      await pool.query("select public.sales_campaign_mark($1, 'retry', '{\"error\":\"503\"}', $2)", [m[0].message.id, at.toISOString()]);
      at = new Date(at.getTime() + 3 * 3_600_000);
    }
    expect(await campaign(c.campaign_id)).toMatchObject({ status: "failed_delivery" });
  });
  it("holds a rep's emails while their @built2bid.org address is removed, and sends once one is assigned", async () => {
    const id = await lead(ritaU, "Hold Builders", "hold@wait.test");
    await pool.query("update public.sales_nurture_settings set paused = false, test_recipients = array_append(test_recipients, 'hold@wait.test')");
    const c = await start(ritaU, id, "no_answer");
    await pool.query("select public.admin_sales_rep_sender($1, $2, null)", [owner, rita]);
    expect(await val("select public.sales_campaign_claim_one($1)", [c.message_id])).toBeNull();
    const claimed = (await val("select public.sales_campaign_claim(now(), 50)")) as Row;
    expect((claimed.messages as Row[]).filter((m) => m.campaign.id === c.campaign_id)).toHaveLength(0);
    expect(await val("select status from public.sales_campaign_messages where id = $1", [c.message_id])).toBe("scheduled");
    expect((await campaign(c.campaign_id)).status).toBe("active");
    expect(((await rpc(ritaU, "select public.sales_campaign_lead($1)", [id])) as Row).can_start.answered).toBe("no_sender");
    await pool.query("select public.admin_sales_rep_sender($1, $2, 'rita@built2bid.org')", [owner, rita]);
    const ctx = (await val("select public.sales_campaign_claim_one($1)", [c.message_id])) as Row;
    expect(ctx.rep.from_email).toBe("rita@built2bid.org");
    await pool.query("select public.sales_campaign_mark($1, 'retry', '{}'::jsonb)", [c.message_id]);
    await rpc(ritaU, "select public.sales_campaign_control($1, 'stop')", [c.campaign_id]);
  });
});
