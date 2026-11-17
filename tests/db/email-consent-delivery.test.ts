import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";
import { pgSupabase } from "./pg-supabase";
import { MARKETING_CONSENT_VERSION, recordMarketingConsent } from "@/lib/email/consent";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

d("marketing consent + delivery metrics (migration 20261123001000)", () => {
  let a = "", b = "";
  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_email_consent"));
    a = await createUser(pool, "a@contractor.dev");
    b = await createUser(pool, "b@contractor.dev");
    await pool.query("insert into public.profiles (id) values ($1), ($2) on conflict do nothing", [a, b]);
  });
  afterAll(async () => { await drop?.(); });

  it("new accounts are not opted in", async () => {
    const r = await pool.query("select marketing_opt_in, marketing_consent_source from public.profiles where id = $1", [a]);
    expect(r.rows[0]).toEqual({ marketing_opt_in: false, marketing_consent_source: null });
  });

  it("records opt-in with source and version, then opt-out keeps the history", async () => {
    const db = pgSupabase(pool);
    await recordMarketingConsent(db, a, { optIn: true, source: "signup_dialog" });
    let r = await pool.query("select marketing_opt_in, marketing_consent_source, marketing_consent_version, marketing_opt_in_at is not null as at from public.profiles where id = $1", [a]);
    expect(r.rows[0]).toEqual({ marketing_opt_in: true, marketing_consent_source: "signup_dialog", marketing_consent_version: MARKETING_CONSENT_VERSION, at: true });
    await recordMarketingConsent(db, a, { optIn: false, source: "unsubscribe_link" });
    r = await pool.query("select marketing_opt_in, marketing_opt_out_at is not null as out from public.profiles where id = $1", [a]);
    expect(r.rows[0]).toEqual({ marketing_opt_in: false, out: true });
    const ev = await pool.query("select opted_in, source from public.marketing_consent_events where user_id = $1 order by id", [a]);
    expect(ev.rows).toEqual([{ opted_in: true, source: "signup_dialog" }, { opted_in: false, source: "unsubscribe_link" }]);
  });

  it("people read only their own consent events and can't write them", async () => {
    const mine = await asUser(pool, b, (q) => q("select count(*)::int n from public.marketing_consent_events"));
    expect(mine.rows[0].n).toBe(0);
    await expect(asUser(pool, b, (q) => q("insert into public.marketing_consent_events (user_id, opted_in, source, notice_version) values ($1, true, 'x', 'v')", [b]))).rejects.toThrow();
  });

  it("delivery events are service-role only and dedupe by provider event id", async () => {
    const ins = "insert into public.email_delivery_events (provider_event_id, kind, stream, recipient_domain, email_created_at, received_at) values ($1, $2, 'auth', 'gmail.com', now() - interval '4 seconds', now()) on conflict (provider_event_id) do nothing";
    await pool.query(ins, ["resend:1", "sent"]);
    await pool.query(ins, ["resend:2", "delivered"]);
    await pool.query(ins, ["resend:2", "delivered"]);
    const day = await pool.query("select stream, sent::int, delivered::int, median_delivery_s from public.email_delivery_daily");
    expect(day.rows[0]).toMatchObject({ stream: "auth", sent: 1, delivered: 1 });
    expect(Number(day.rows[0].median_delivery_s)).toBeGreaterThan(3);
    await expect(asUser(pool, a, (q) => q("select * from public.email_delivery_events"))).rejects.toThrow();
    await expect(pool.query("insert into public.email_delivery_events (provider_event_id, kind, stream) values ('x', 'opened', 'auth')")).rejects.toThrow();
  });
});
