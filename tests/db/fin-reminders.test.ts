/**
 * Automatic payment reminders (src/lib/financials/reminder-run.ts via runComms):
 *   - nothing is planned while the rules are off (the default) or before 9 AM in the book's time zone
 *   - a past-due invoice gets one reminder, sent from the company name to the customer, at most once per run/day
 *   - a payment that clears the balance cancels a reminder that is waiting to send
 *   - the "before due" reminder never goes out once the invoice is past due
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { pgSupabase } from "./pg-supabase";
import { asFn, setupWorld, wonBid, type World } from "./fin-fixtures";
import type { CommConfig } from "@/lib/comms/config";
import { deliverDue } from "@/lib/comms/runner";
import { planFinancialReminders } from "@/lib/financials/reminder-run";

process.env.COMM_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret-0123456789";
const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

const cfg: CommConfig = {
  mode: "live", enabled: true, reason: null, apiKey: "re_test", fromAddress: "updates@built2bid.org", replyDomain: null,
  webhookSecret: "", inboundSecret: "", testRecipients: [], dailyCap: 300, accountDailyCap: 60,
};
const sends: { to: string[]; subject: string; text: string; from: string }[] = [];

d("automatic payment reminders (database)", () => {
  let as: ReturnType<typeof asFn>;
  let admin: ReturnType<typeof pgSupabase>;
  let job: string;
  const reminders = async () => (await pool.query("select * from public.comm_messages where kind = 'financial' and automation order by created_at")).rows as Row[];
  const invoice = async (amount: string, dueDate: string) => {
    const id = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { kind: "custom", dueDate, lines: [{ description: "Extra work", quantity: "1", unitPrice: amount }] }])).r.invoiceId as string;
    await as(w.bk, "select public.fin_invoice_issue($1, $2::date)", [id, "2026-11-01"]);
    return id;
  };
  const rules = (p: Row[]) => as(w.owner, "select public.fin_email_config_save($1, $2)", [w.book, { reminders: p }]);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_reminders"));
    w = await setupWorld(pool);
    as = asFn(pool);
    admin = pgSupabase(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    const est = await wonBid(pool, w.owner, w.company, { title: "Siding", total: "10000.00" });
    job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sends.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: `re_${sends.length}` }), { status: 200, headers: { "content-type": "application/json" } });
    }));
  }, 120_000);
  afterAll(async () => { vi.unstubAllGlobals(); await drop?.(); });

  it("plans nothing while reminders are off, and nothing before 9 AM local time", async () => {
    await invoice("250.00", "2026-11-20");
    const out: Record<string, number> = {};
    await planFinancialReminders(admin, new Date("2026-11-25T16:00:00Z"), out);
    expect(await reminders()).toHaveLength(0);
    await rules([{ kind: "overdue_reminder", enabled: true, offsetDays: 2, repeatEveryDays: 7, maxReminders: 2 }]);
    await planFinancialReminders(admin, new Date("2026-11-25T13:00:00Z"), out); // 7 AM in Chicago
    expect(await reminders()).toHaveLength(0);
  });

  it("sends one past-due reminder to the customer under the company's name, once per day", async () => {
    const now = new Date("2026-11-25T16:00:00Z");
    const out: Record<string, number> = {};
    await planFinancialReminders(admin, now, out);
    await planFinancialReminders(admin, now, out);
    const planned = await reminders();
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ status: "scheduled", fin_template_kind: "overdue_reminder", to_email: "pat@example.test", fin_book_id: w.book });
    await deliverDue(admin, now, cfg, false, out);
    expect(sends).toHaveLength(1);
    expect(sends[0].to).toEqual(["pat@example.test"]);
    expect(sends[0].subject).toMatch(/Past due: invoice/);
    expect(sends[0].text).toMatch(/\$250\.00/);
    expect((await reminders())[0].status).toBe("sent");
    // Next day: inside the two-day gap and before the 7-day repeat, nothing new.
    await planFinancialReminders(admin, new Date("2026-11-26T16:00:00Z"), out);
    expect(await reminders()).toHaveLength(1);
  });

  it("a payment that clears the balance cancels the waiting reminder", async () => {
    const out: Record<string, number> = {};
    const later = new Date("2026-12-02T16:00:00Z");
    await planFinancialReminders(admin, later, out);
    const waiting = (await reminders()).filter((m) => m.status === "scheduled");
    expect(waiting).toHaveLength(1);
    const inv = String(waiting[0].fin_invoice_id);
    await as(w.bk, "select public.fin_payment_record($1, $2, $3)", [w.book, { customerId: waiting[0].customer_id ?? undefined, jobId: job, method: "check", amount: "250.00", receivedOn: "2026-12-01", allocations: [{ invoiceId: inv, amount: "250.00" }] }, "rem-pay-1"]);
    await deliverDue(admin, later, cfg, false, out);
    expect(sends).toHaveLength(1);
    const after = (await reminders()).find((m) => m.id === waiting[0].id)!;
    expect(after.status).toBe("canceled");
    expect(after.status_reason).toBe("Invoice is paid");
  });

  it("the before-due reminder never sends once the invoice is past due", async () => {
    await rules([{ kind: "balance_reminder", enabled: true, offsetDays: 3, repeatEveryDays: null, maxReminders: 1 }, { kind: "overdue_reminder", enabled: false, offsetDays: 2, repeatEveryDays: 7, maxReminders: 2 }]);
    const id = await invoice("400.00", "2026-12-10");
    const out: Record<string, number> = {};
    await planFinancialReminders(admin, new Date("2026-12-08T16:00:00Z"), out);
    const m = (await reminders()).find((x) => x.fin_invoice_id === id)!;
    expect(m).toMatchObject({ fin_template_kind: "balance_reminder", status: "scheduled" });
    // Not delivered until after the due date: it is canceled, not sent late.
    await deliverDue(admin, new Date("2026-12-11T16:00:00Z"), cfg, false, out);
    expect(sends).toHaveLength(1);
    expect((await reminders()).find((x) => x.id === m.id)!.status).toBe("canceled");
  });
});
