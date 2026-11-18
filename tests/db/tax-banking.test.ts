/**
 * V6.9 tax intelligence + connected banking (20261226001000), against the real SQL.
 * Scenario numbers refer to the spec's 40 required scenarios (pure logic ones are in tests/tax-banking.test.ts).
 *   - authority registry (51), versioned rate changes: verified numeric rate auto-activates on its date, rule changes
 *     and conflicting/unverified reports go to review; duplicates collapse; history is append-only
 *   - alerts: one per book per change (no repeat on re-run), quarterly digest once, preferences respected
 *   - snapshots: locked calcs immutable, corrections are new rows; estimate calcs owner-only; invoice calcs need create_invoices
 *   - banking: connect (mock only in practice books), masked accounts, primary account, token table unreadable,
 *     feed ingest (balances + lines into the V6.3 tables, de-duped), failures/reconnect, disconnect keeps history,
 *     reconciliation matching on feed lines, roles (sales rep / view-only can't see balances), cash plan
 *   - owner monitoring is aggregate-only; rollback + re-apply
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigration, dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, finAddon, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";
import { assertTestIsolation } from "@/lib/tax-banking/isolation";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("V6.9 tax + banking (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  const change = (p: Row) => pool.query("select public.tax_change_record($1) as r", [{ source: "provider", provider: "mock", verified: true, sourcesAgree: true, level: "state", ...p }]).then((x) => x.rows[0].r as Row);

  beforeAll(async () => {
    assertTestIsolation();
    ({ pool, drop } = await freshDb("byb_test_tax_banking"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await finAddon(pool, w.owner, true, 1);   // one extra seat: owner + bookkeeper + sales rep + view-only
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'sales_rep')", [w.book, w.rep]);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'view_only')", [w.book, w.viewer]);
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("registry: 50 states + DC, readable by anyone, not writable", async () => {
    expect((await pool.query("select count(*)::int n, count(*) filter (where source_status = 'needs_verification')::int nv from public.tax_authorities")).rows[0]).toEqual({ n: 51, nv: 51 });
    expect((await rows(w.rep, "select authority from public.tax_authorities where state = 'TN'"))[0].authority).toBe("Tennessee Department of Revenue");
    expect(await fails(as(w.owner, "update public.tax_authorities set authority = 'x' where state = 'MN'"))).toMatch(/permission denied/);
  });

  it("tax profile: managers of financial config only; paid providers can't be chosen from a form; email off by default", async () => {
    expect(await fails(as(w.rep, "select public.fin_tax_profile_save($1, $2)", [w.book, { primaryState: "MN" }]))).toMatch(/forbidden/);
    expect(await fails(as(w.owner, "select public.fin_tax_profile_save($1, $2)", [w.book, { primaryState: "MN", provider: "avalara" }]))).toMatch(/provider_not_approved/);
    await as(w.owner, "select public.fin_tax_profile_save($1, $2)", [w.book, { primaryState: "MN", serviceStates: ["WI", "TN"], address: { line1: "1 Main", city: "Rochester", state: "MN", zip: "55901" } }]);
    const p = (await rows(w.owner, "select * from public.fin_tax_profiles where book_id = $1", [w.book]))[0];
    expect(p.service_states.sort()).toEqual(["MN", "TN", "WI"]);   // scenario 3: several states
    expect(p).toMatchObject({ notify_email: false, notify_immediate: true, notify_quarterly: true, auto_apply_rates: true });
    expect(await fails(as(w.owner, "select public.fin_tax_profile_save($1, $2)", [w.book, { serviceStates: ["XX"] }]))).toMatch(/fin_tax_profiles_states/);
    await as(w.rival, "select public.fin_tax_profile_save($1, $2)", [w.rivalBook, { primaryState: "TX" }]);
  });

  let mnChange: string;
  it("scenarios 1 + 5 + 6: a verified MN rate change is versioned, scheduled, activates on its date; old versions stay", async () => {
    await change({ state: "MN", jurisdictionCode: "MN", jurisdictionName: "Minnesota", kind: "rate", summary: "Minnesota rate recorded", newRate: "6.875", effectiveDate: "2020-01-01" });
    const r = await change({ state: "MN", jurisdictionCode: "MN", jurisdictionName: "Minnesota", kind: "rate", summary: "Minnesota rate changes", oldRate: "6.875", newRate: "7.0", effectiveDate: "2099-01-01" });
    mnChange = String(r.id);
    expect(r).toMatchObject({ status: "scheduled", duplicate: false });
    expect((await pool.query("select public.tax_rate_on('MN', 'MN', '2098-12-31') a, public.tax_rate_on('MN', 'MN', '2099-01-01') b")).rows[0]).toEqual({ a: "6.87500", b: "7.00000" });
    expect(await pool.query("select public.tax_activate_due('2098-12-31') n").then((x) => x.rows[0].n)).toBe(0);
    expect(await pool.query("select public.tax_activate_due('2099-01-01') n").then((x) => x.rows[0].n)).toBe(1);
    expect(await fails(pool.query("update public.tax_jurisdiction_rates set rate = 1"))).toMatch(/record_immutable/);
    expect(await fails(pool.query("update public.tax_change_events set new_rate = 9 where id = $1", [mnChange]))).toMatch(/record_immutable/);
    expect(await fails(pool.query("delete from public.tax_change_events where id = $1", [mnChange]))).toMatch(/record_immutable/);
  });

  it("scenario 2 + duplicates: a TN update recorded twice is one event", async () => {
    const a = await change({ state: "TN", jurisdictionCode: "TN-LO-A", jurisdictionName: "Local A", level: "county", kind: "rate", summary: "Local A rate changes", oldRate: "2.25", newRate: "2.75", effectiveDate: "2026-10-01" });
    const b = await change({ state: "TN", jurisdictionCode: "TN-LO-A", jurisdictionName: "Local A", level: "county", kind: "rate", summary: "Local A rate changes", oldRate: "2.25", newRate: "2.75", effectiveDate: "2026-10-01" });
    expect(a.status).toBe("active");
    expect(b).toMatchObject({ id: a.id, duplicate: true });
  });

  it("scenarios 8 + 13: rule changes, unverified and conflicting reports never auto-apply", async () => {
    expect((await change({ state: "TX", jurisdictionCode: "TX", jurisdictionName: "Texas", kind: "taxability", summary: "Repair labor treatment clarified", effectiveDate: "2026-12-01" })).status).toBe("needs_review");
    expect((await change({ state: "WI", jurisdictionCode: "WI", jurisdictionName: "Wisconsin", kind: "rate", summary: "Unverified rate", newRate: "5.1", effectiveDate: "2026-12-01", verified: false })).status).toBe("needs_review");
    expect((await change({ state: "WI", jurisdictionCode: "WI", jurisdictionName: "Wisconsin", kind: "rate", summary: "Disputed rate", newRate: "5.2", effectiveDate: "2026-12-01", sourcesAgree: false })).status).toBe("needs_review");
    expect(Number((await pool.query("select count(*) n from public.tax_jurisdiction_rates where state in ('TX', 'WI') and source <> 'seed'")).rows[0].n)).toBe(0);
    expect(await fails(pool.query("update public.tax_change_events set status = 'active' where state = 'TX'"))).toMatch(/tax_change_events_auto/);
  });

  it("scenarios 16 + 17: alerts reach books serving the state once, link the official source; quarterly digest once", async () => {
    expect(await pool.query("select public.tax_fanout_alerts($1) n", [mnChange]).then((x) => x.rows[0].n)).toBe(1);
    expect(await pool.query("select public.tax_fanout_alerts($1) n", [mnChange]).then((x) => x.rows[0].n)).toBe(0);
    const a = (await rows(w.owner, "select * from public.fin_tax_alerts where book_id = $1", [w.book]))[0];
    expect(a).toMatchObject({ kind: "rate_change", state: "MN", auto_updated: true, review_needed: false, source_url: "https://www.revenue.state.mn.us/" });
    expect(a.title).toMatch(/Minnesota service area have changed/);
    expect(a.impact).toMatch(/6\.875% to 7%/);
    const tx = (await pool.query("select id from public.tax_change_events where state = 'TX'")).rows[0].id;
    await pool.query("select public.tax_fanout_alerts($1)", [tx]);
    expect((await rows(w.rival, "select review_needed, auto_updated from public.fin_tax_alerts where book_id = $1", [w.rivalBook]))[0]).toEqual({ review_needed: true, auto_updated: false });
    expect(await rows(w.rival, "select id from public.fin_tax_alerts where book_id = $1", [w.book])).toHaveLength(0);   // other company: invisible
    expect(await rows(w.rep, "select id from public.fin_tax_alerts")).toHaveLength(0);   // sales rep: no company financials
    const q = (await pool.query("select public.tax_quarterly_digest(current_date) n")).rows[0].n;
    expect(q).toBeGreaterThanOrEqual(1);
    expect((await pool.query("select public.tax_quarterly_digest(current_date) n")).rows[0].n).toBe(0);
    await as(w.owner, "select public.fin_tax_alert_act($1, 'dismissed')", [a.id]);
    expect(await fails(as(w.rep, "select public.fin_tax_alert_act($1, 'reviewed')", [a.id]))).toMatch(/forbidden|not_found/);
  });

  it("only the service role records changes or ingests bank feeds", async () => {
    expect(await fails(as(w.owner, "select public.tax_change_record('{}'::jsonb)"))).toMatch(/permission denied/);
    expect(await fails(as(w.owner, "select public.fin_bank_feed_ingest(gen_random_uuid(), '{}'::jsonb)"))).toMatch(/permission denied/);
    expect(await fails(as(w.owner, "select public.admin_tax_banking_health()"))).toMatch(/permission denied/);
  });

  let estId: string, invoiceId: string, lockedCalc: string;
  it("scenarios 18 + 19: draft estimate calcs owner-only; a finalized proposal snapshot is locked forever", async () => {
    const est = await wonBid(pool, w.owner, w.company);
    estId = est.id;
    const calc = { subjectType: "estimate", subjectId: estId, taxableAmount: "6000.00", nontaxableAmount: "4000.00", taxAmount: "472.50", combinedRate: "7.875", source: "mock",
      address: { state: "MN", zip: "55901" }, jurisdictions: [{ name: "Minnesota", rate: "6.875" }], reviewReasons: [] };
    const draft = (await as<{ id: string }>(w.owner, "select public.tax_calc_record($1, false) as id", [calc])).id;
    expect(await fails(as(w.rep, "select public.tax_calc_record($1, false)", [calc]))).toMatch(/forbidden/);
    lockedCalc = (await as<{ id: string }>(w.owner, "select public.tax_calc_record($1, true) as id", [{ ...calc, subjectType: "proposal_version", subjectId: est.v1 }])).id;
    expect(await fails(pool.query("update public.tax_calculations set tax_amount = 1 where id = $1", [lockedCalc]))).toMatch(/record_immutable/);
    expect(await fails(pool.query("delete from public.tax_calculations where id = $1", [lockedCalc]))).toMatch(/record_immutable/);
    expect(await fails(pool.query("update public.tax_calculations set tax_amount = 1 where id = $1", [draft]))).toMatch(/record_immutable/);
    expect(await rows(w.owner, "select id from public.tax_calculations where estimate_id = $1", [estId])).toHaveLength(2);
    expect(await rows(w.rival, "select id from public.tax_calculations where estimate_id = $1", [estId])).toHaveLength(0);
  });

  it("scenario 20: invoice snapshot needs create_invoices; correction is a new row pointing at the original", async () => {
    const job = (await as<{ r: Row }>(w.bk, "select public.fin_job_open($1, $2) as r", [estId, (await pool.query("select id from public.estimate_versions where estimate_id = $1", [estId])).rows[0].id])).r.jobId;
    invoiceId = (await as<{ r: Row }>(w.bk, "select public.fin_invoice_save($1, $2) as r", [job, { kind: "custom", lines: [{ kind: "custom", description: "Deck", quantity: "1", unitPrice: "1000.00", taxable: true }] }])).r.invoiceId;
    const c = { subjectType: "invoice", subjectId: invoiceId, taxableAmount: "1000.00", taxAmount: "78.75", combinedRate: "7.875", source: "mock" };
    expect(await fails(as(w.rep, "select public.tax_calc_record($1, true)", [c]))).toMatch(/forbidden/);
    const orig = (await as<{ id: string }>(w.bk, "select public.tax_calc_record($1, true) as id", [c])).id;
    expect(await fails(as(w.bk, "select public.tax_calc_record($1, true)", [{ ...c, taxAmount: "80.00", supersedes: orig }]))).toMatch(/reason_required/);
    const fix = (await as<{ id: string }>(w.bk, "select public.tax_calc_record($1, true) as id", [{ ...c, taxAmount: "80.00", combinedRate: "8.0", supersedes: orig, correctionReason: "Rate changed before invoice date" }])).id;
    expect(await fails(as(w.bk, "select public.tax_calc_record($1, true)", [{ ...c, supersedes: orig, correctionReason: "again" }]))).toMatch(/duplicate|unique/);
    const all = await rows(w.bk, "select id, supersedes, locked from public.tax_calculations where subject_id = $1 order by calculated_at", [invoiceId]);
    expect(all.map((r) => r.id)).toEqual([orig, fix]);
    expect((await rows(w.owner, "select count(*)::int n from public.fin_audit_log where action = 'tax.corrected'"))[0].n).toBe(1);
  });

  it("exemption certificates: config managers add them for their own customers only", async () => {
    const cust = (await pool.query("select customer_id from public.estimates where id = $1", [estId])).rows[0].customer_id;
    const ex = (await as<{ id: string }>(w.owner, "select public.fin_tax_exemption_save($1, $2) as id", [w.book, { customerId: cust, state: "MN", reason: "nonprofit", certificateRef: "4411", expiresOn: "2027-12-31" }])).id;
    expect(ex).toBeTruthy();
    expect(await fails(as(w.rival, "select public.fin_tax_exemption_save($1, $2)", [w.rivalBook, { customerId: cust, state: "TX", reason: "resale" }]))).toMatch(/not_found/);
    expect(await fails(as(w.bk, "select public.fin_tax_exemption_save($1, $2)", [w.book, { customerId: cust, state: "MN", reason: "resale" }]))).toMatch(/forbidden/);
  });

  let conn: string, chk: string, sav: string;
  it("scenarios 21 + 22: mock link only in a practice book; masked accounts; first checking becomes primary; token table unreadable", async () => {
    const p = { provider: "mock", itemRef: "mock-item-1", institutionName: "Sandbox Community Bank (mock)", accounts: [
      { ref: "mock-chk", name: "Business Checking", mask: "4821", kind: "checking" }, { ref: "mock-sav", name: "Business Savings", mask: "9034", kind: "savings" }] };
    expect(await fails(as(w.owner, "select public.fin_bank_connection_create($1, $2)", [w.book, p]))).toMatch(/mock_outside_sandbox/);
    expect(await fails(as(w.bk, "select public.fin_bank_connection_create($1, $2)", [w.book, { ...p, sandbox: true }]))).toMatch(/forbidden/);   // bookkeeper can't connect
    expect(await fails(as(w.owner, "select public.fin_bank_connection_create($1, $2)", [w.book, { ...p, sandbox: true, accounts: [{ ref: "x", name: "x", mask: "12345678" }] }]))).toMatch(/bad_last4/);
    const r = (await as<{ r: Row }>(w.owner, "select public.fin_bank_connection_create($1, $2) as r", [w.book, { ...p, sandbox: true }])).r;
    conn = r.connectionId;
    [chk, sav] = r.accounts.map((a: Row) => a.accountId);
    const accts = await rows(w.bk, "select id, last4, is_primary, source from public.fin_bank_accounts where connection_id = $1 order by name", [conn]);
    expect(accts.map((a) => [a.last4, a.is_primary, a.source])).toEqual([["4821", true, "provider_feed"], ["9034", false, "provider_feed"]]);
    await pool.query("insert into public.fin_bank_connection_secrets (connection_id, token_ciphertext) values ($1, $2)", [conn, "v1.aaaaaaaaaaaaaaaa.bbbb.cccc"]);
    expect(await fails(as(w.owner, "select * from public.fin_bank_connection_secrets"))).toMatch(/permission denied/);
    expect(await fails(as(w.owner, "insert into public.fin_bank_connection_secrets values ($1, 'x')", [conn]))).toMatch(/permission denied/);
    await as(w.owner, "select public.fin_bank_set_primary($1)", [sav]);
    expect((await rows(w.owner, "select id from public.fin_bank_accounts where book_id = $1 and is_primary", [w.book])).map((x) => x.id)).toEqual([sav]);
    await as(w.owner, "select public.fin_bank_set_primary($1)", [chk]);
  });

  const feed = { status: "active", balances: [{ ref: "mock-chk", current: "42500.00", available: "41250.00", asOf: "2026-11-18T13:00:00Z" }, { ref: "mock-sav", current: "8000.00", available: "8000.00", asOf: "2026-11-18T13:00:00Z" }],
    transactions: [
      { ref: "mock-chk", txnRef: "m1", date: "2026-11-09", description: "Deposit Pat Rivera", amount: "12000.00" },
      { ref: "mock-chk", txnRef: "m2", date: "2026-11-11", description: "Check 1001 Lumber Yard", amount: "-600.00", checkNumber: "1001" },
      { ref: "mock-chk", txnRef: "m4", date: "2026-11-15", description: "Online transfer to savings", amount: "-1000.00" },
      { ref: "mock-sav", txnRef: "m5", date: "2026-11-15", description: "Online transfer from checking", amount: "1000.00" }] };
  it("scenarios 23–25 + 37: feed ingest stores bank-reported balances + lines once; opening balance derived so reconciliation ties out", async () => {
    const r = (await pool.query("select public.fin_bank_feed_ingest($1, $2) as r", [conn, feed])).rows[0].r;
    expect(r).toMatchObject({ status: "active", inserted: 4, balances: 2 });
    const again = (await pool.query("select public.fin_bank_feed_ingest($1, $2) as r", [conn, feed])).rows[0].r;
    expect(again.inserted).toBe(0);   // duplicate transactions never land twice
    const bal = (await rows(w.bk, "select current_balance, available_balance, as_of from public.fin_bank_balances where account_id = $1 order by recorded_at desc limit 1", [chk]))[0];
    expect(bal).toMatchObject({ current_balance: "42500.00", available_balance: "41250.00" });
    const a = (await rows(w.bk, "select opening_balance, opening_date::text from public.fin_bank_accounts where id = $1", [chk]))[0];
    expect(a.opening_balance).toBe("32100.00");   // 42,500 − (12,000 − 600 − 1,000)
    const c = (await rows(w.bk, "select status, last_success_at is not null ok from public.fin_bank_connections where id = $1", [conn]))[0];
    expect(c).toEqual({ status: "active", ok: true });
    expect(await fails(pool.query("update public.fin_bank_balances set current_balance = 1"))).toMatch(/record_immutable/);
  });

  it("scenario 39: balances and connections are hidden from sales reps and view-only seats (server-side)", async () => {
    expect(await rows(w.rep, "select id from public.fin_bank_balances")).toHaveLength(0);
    expect(await rows(w.viewer, "select id from public.fin_bank_balances")).toHaveLength(0);
    expect(await rows(w.viewer, "select id from public.fin_bank_connections")).toHaveLength(0);
    expect(await rows(w.rival, "select id from public.fin_bank_balances")).toHaveLength(0);
    expect(await rows(w.bk, "select id from public.fin_bank_balances")).toHaveLength(4);   // one snapshot per account per sync
    expect(await fails(as(w.rep, "select public.fin_bank_refresh_allowed($1)", [conn]))).toMatch(/forbidden/);
  });

  it("scenario 36: feed lines use the Accountant Mode matching (same amount, one match per line)", async () => {
    const pay = (await as<{ r: Row }>(w.bk, "select public.fin_payment_record($1, $2) as r", [w.book, { customerId: (await pool.query("select customer_id from public.estimates where id = $1", [estId])).rows[0].customer_id, method: "check", amount: "12000.00" }])).r.paymentId;
    const line = (await pool.query("select id from public.fin_bank_transactions where account_id = $1 and bank_ref = 'm1'", [chk])).rows[0].id;
    await as(w.bk, "select public.fin_bank_match($1, $2)", [line, { targetType: "payment", targetId: pay }]);
    expect(await fails(as(w.bk, "select public.fin_bank_match($1, $2)", [line, { targetType: "excluded", excludeReason: "transfer" }]))).toMatch(/already_matched/);
    const out = (await pool.query("select id from public.fin_bank_transactions where bank_ref = 'm4'")).rows[0].id;
    await as(w.bk, "select public.fin_bank_match($1, $2)", [out, { targetType: "excluded", excludeReason: "transfer" }]);
    expect(await fails(pool.query("delete from public.fin_bank_transactions where id = $1", [line]))).toMatch(/record_immutable/);   // bank-source record kept
  });

  it("scenarios 26–28: failed sync / expired auth keep the last balance and flag the connection; reconnect restores", async () => {
    await pool.query("select public.fin_bank_feed_ingest($1, $2)", [conn, { status: "needs_reauth", errorCode: "ITEM_LOGIN_REQUIRED", errorMessage: "Sign in again" }]);
    const c = (await rows(w.bk, "select status, error_code, last_success_at from public.fin_bank_connections where id = $1", [conn]))[0];
    expect(c).toMatchObject({ status: "needs_reauth", error_code: "ITEM_LOGIN_REQUIRED" });
    expect(c.last_success_at).not.toBeNull();
    expect((await rows(w.bk, "select count(*)::int n from public.fin_bank_balances where account_id = $1", [chk]))[0].n).toBe(2);   // nothing invented
    await pool.query("select public.fin_bank_feed_ingest($1, $2)", [conn, { ...feed, balances: [{ ref: "mock-chk", current: "43000.00", available: "43000.00", asOf: "2026-11-19T13:00:00Z" }] }]);
    expect((await rows(w.bk, "select status, error_code from public.fin_bank_connections where id = $1", [conn]))[0]).toEqual({ status: "active", error_code: null });
  });

  it("manual refresh is rate limited per connection per day", async () => {
    for (let i = 0; i < 5; i++) await as(w.bk, "select public.fin_bank_refresh_allowed($1)", [conn]);
    expect(await fails(as(w.bk, "select public.fin_bank_refresh_allowed($1)", [conn]))).toMatch(/rate_limited/);
  });

  it("cash plan: reconcile permission; transfer needs both accounts; validation", async () => {
    expect(await fails(as(w.viewer, "select public.fin_cash_event_save($1, $2)", [w.book, { kind: "payroll", label: "Payroll", amount: "6000.00", expectedOn: "2026-11-21" }]))).toMatch(/forbidden/);
    await as(w.bk, "select public.fin_cash_event_save($1, $2)", [w.book, { kind: "payroll", label: "Payroll", amount: "6000.00", expectedOn: "2026-11-21", recurrence: "biweekly" }]);
    await as(w.bk, "select public.fin_cash_event_save($1, $2)", [w.book, { kind: "transfer", label: "To savings", amount: "500.00", expectedOn: "2026-11-25", accountId: chk, toAccountId: sav }]);
    expect(await fails(as(w.bk, "select public.fin_cash_event_save($1, $2)", [w.book, { kind: "transfer", label: "x", amount: "1.00", expectedOn: "2026-11-25" }]))).toMatch(/fin_cash_events_transfer/);
    expect(await fails(as(w.bk, "select public.fin_cash_event_save($1, $2)", [w.book, { kind: "payroll", label: "x", amount: "-1", expectedOn: "2026-11-25" }]))).toMatch(/bad_amount/);
    const dep = (await as<{ v: string }>(w.bk, "select public.fin_cash_event_save($1, $2) as v", [w.book, { kind: "expected_deposit", label: "Check from Pat", amount: "2000.00", expectedOn: "2026-11-27", invoiceId }])).v;
    expect((await rows(w.bk, "select certainty, direction from public.fin_cash_events where id = $1", [dep]))[0]).toEqual({ certainty: "expected", direction: "in" });
    expect(await rows(w.viewer, "select id from public.fin_cash_events")).toHaveLength(3);   // forecast viewers can read the plan
  });

  it("scenario 38: disconnect destroys the token, keeps lines + balances, stops sync; viewers can't disconnect", async () => {
    expect(await fails(as(w.bk, "select public.fin_bank_connection_disconnect($1, 'x')", [conn]))).toMatch(/forbidden/);
    await as(w.owner, "select public.fin_bank_connection_disconnect($1, 'Switching banks')", [conn]);
    expect(Number((await pool.query("select count(*) n from public.fin_bank_connection_secrets where connection_id = $1", [conn])).rows[0].n)).toBe(0);
    expect(Number((await pool.query("select count(*) n from public.fin_bank_transactions where account_id = $1", [chk])).rows[0].n)).toBe(3);
    expect(await fails(pool.query("select public.fin_bank_feed_ingest($1, $2)", [conn, feed]))).toMatch(/disconnected/);
    expect((await rows(w.owner, "select status from public.fin_bank_connections where id = $1", [conn]))[0].status).toBe("disconnected");
  });

  it("built-in engine: official imports version rates, baselines don't alert, corrections go to review, official beats seed", async () => {
    const imp = (rows: Row[]) => pool.query("select public.tax_official_import('IA', null, 'https://example.gov/IAR.csv', $1) r", [JSON.stringify(rows)]).then((x) => x.rows[0].r as Row);
    expect(Number((await pool.query("select public.tax_rate_on('IA', 'IA', '2026-11-18') r")).rows[0].r)).toBe(6);            // seed until the official import
    const first = await imp([{ code: "IA", name: "IA", level: "state", rate: "6", effectiveFrom: "2008-07-01" }, { code: "IA-CO-153", name: "County 153", level: "county", rate: "1", effectiveFrom: "2020-01-01" }]);
    expect(first).toMatchObject({ found: 2, applied: 2, alertIds: [] });
    expect(Number((await pool.query("select count(*) n from public.tax_change_events where state = 'IA' and fanned_out_at is null")).rows[0].n)).toBe(0);   // baselines never alert
    expect((await imp([{ code: "IA", name: "IA", level: "state", rate: "6", effectiveFrom: "2008-07-01" }])).found).toBe(0);                            // unchanged = nothing
    const change = await imp([{ code: "IA-CO-153", name: "County 153", level: "county", rate: "1.5", effectiveFrom: "2027-01-01" }]);
    expect(change).toMatchObject({ found: 1, applied: 1 });
    expect((change.alertIds as string[]).length).toBe(1);
    expect(Number((await pool.query("select public.tax_rate_on('IA', 'IA-CO-153', '2026-12-31') a, 1 b")).rows[0].a)).toBe(1);
    expect(Number((await pool.query("select public.tax_rate_on('IA', 'IA-CO-153', '2027-01-02') a")).rows[0].a)).toBe(1.5);
    const corr = await imp([{ code: "IA-CO-153", name: "County 153", level: "county", rate: "1.25", effectiveFrom: "2027-01-01" }]);
    expect(corr).toMatchObject({ found: 1, review: 1 });
    expect(Number((await pool.query("select public.tax_rate_on('IA', 'IA-CO-153', '2027-01-02') a")).rows[0].a)).toBe(1.5);        // history not overwritten
    expect(await fails(as(w.owner, "select public.tax_official_import('IA', null, null, '[]'::jsonb)"))).toMatch(/permission denied/);
  });

  it("built-in engine: boundaries switch live per state; geocode cache is service-role only", async () => {
    const run1 = "11111111-1111-4111-8111-111111111111", run2 = "22222222-2222-4222-8222-222222222222";
    await pool.query("select public.tax_zip_areas_load('IA', $1, $2)", [run1, JSON.stringify([{ zip5: "52240", countyFips: "103", placeFips: "38595", specials: [], weight: 3 }])]);
    expect((await rows(w.owner, "select * from public.tax_zip_areas where state = 'IA'")).length).toBe(0);                          // not live yet
    await pool.query("select public.tax_zip_areas_commit('IA', $1)", [run1]);
    expect((await rows(w.owner, "select zip5 from public.tax_zip_areas where state = 'IA'")).map((r) => r.zip5)).toEqual(["52240"]);
    await pool.query("select public.tax_zip_areas_load('IA', $1, $2)", [run2, JSON.stringify([{ zip5: "52241", countyFips: "103", specials: ["9"], weight: 1 }])]);
    await pool.query("select public.tax_zip_areas_commit('IA', $1)", [run2]);
    expect((await rows(w.owner, "select zip5, specials from public.tax_zip_areas where state = 'IA'"))).toEqual([{ zip5: "52241", specials: ["9"] }]);
    expect(await fails(pool.query("select public.tax_zip_areas_commit('IA', gen_random_uuid())"))).toMatch(/empty_boundary_load/);
    await pool.query("insert into public.tax_geocode_cache (key, matched, state) values (repeat('a', 64), true, 'IA')");
    expect(await fails(rows(w.owner, "select * from public.tax_geocode_cache"))).toMatch(/permission denied/);
    expect((await rows(w.owner, "select state, kind, status from public.tax_rate_sources where state in ('CT', 'MN', 'OR', 'TX') order by state"))).toEqual([
      { state: "CT", kind: "state_only", status: "not_needed" }, { state: "MN", kind: "sst", status: "needs_link" }, { state: "OR", kind: "none", status: "not_needed" }, { state: "TX", kind: "state_table", status: "needs_link" }]);
  });

  it("online exemption certificate: link by config managers, signed by the customer, saved as exemptions", async () => {
    const cust = (await pool.query("select customer_id from public.estimates where id = $1", [estId])).rows[0].customer_id;
    const hash = "c".repeat(64);
    expect(await fails(as(w.bk, "select public.fin_tax_exemption_request_create($1, $2)", [w.book, { customerId: cust, states: ["MN"], tokenHash: hash }]))).toMatch(/forbidden/);
    expect(await fails(as(w.rival, "select public.fin_tax_exemption_request_create($1, $2)", [w.rivalBook, { customerId: cust, states: ["MN"], tokenHash: hash }]))).toMatch(/not_found/);
    await as(w.owner, "select public.fin_tax_exemption_request_create($1, $2)", [w.book, { customerId: cust, states: ["MN", "WI"], tokenHash: hash }]);
    expect(await fails(rows(w.owner, "select token_hash from public.fin_tax_exemption_requests"))).toMatch(/permission denied/);
    const view = (await pool.query("select public.tax_exemption_request_view($1) v", [hash])).rows[0].v;
    expect(view).toMatchObject({ status: "open", states: ["MN", "WI"] });
    expect(Object.keys(view).sort()).toEqual(["company", "customer", "expiresAt", "signedAt", "states", "status"]);
    const sign = { states: ["MN", "WI"], reasonCode: "G", purchaser: { name: "Pat Buyer", line1: "1 Main", city: "Rochester", state: "MN", zip: "55901", businessType: "Construction" },
      idType: "state_permit", idNumber: "MN-1234567", signerName: "Pat Buyer", statement: "I certify…", ip: "203.0.113.9", userAgent: "test" };
    expect((await pool.query("select public.tax_exemption_sign($1, $2) r", [hash, sign])).rows[0].r).toMatchObject({ states: 2 });
    expect(await fails(pool.query("select public.tax_exemption_sign($1, $2)", [hash, sign]))).toMatch(/link_used/);
    const ex = await rows(w.owner, "select state, reason, certificate_id is not null as online, status from public.fin_tax_exemptions where customer_id = $1 and certificate_id is not null order by state", [cust]);
    expect(ex).toEqual([{ state: "MN", reason: "resale", online: true, status: "active" }, { state: "WI", reason: "resale", online: true, status: "active" }]);
    expect((await rows(w.owner, "select id_number from public.fin_tax_exemption_certificates where customer_id = $1", [cust]))[0].id_number).toBe("MN-1234567");
    expect(await rows(w.rep, "select * from public.fin_tax_exemption_certificates")).toEqual([]);
    expect(await fails(pool.query("update public.fin_tax_exemption_certificates set id_number = 'x'"))).toMatch(/immutable/);
    expect(await fails(as(w.owner, "select public.tax_exemption_sign($1, '{}'::jsonb)", [hash]))).toMatch(/permission denied/);
  });

  it("owner monitoring is aggregate only (no balances, names or transactions)", async () => {
    const h = (await pool.query("select public.admin_tax_banking_health() h")).rows[0].h;
    expect(h.tax.authoritiesTotal).toBe(51);
    expect(h.tax.changesNeedingReview).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(h)).not.toMatch(/42500|Lumber|Pat Rivera|4821/);
  });

  it("rollback removes V6.9 objects, keeps bank-source lines, and the migration re-applies", async () => {
    await pool.query(readFileSync("docs/tax-banking/rollback_20261226001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.tax_calculations') a, to_regclass('public.fin_bank_connections') b")).rows[0]).toEqual({ a: null, b: null });
    expect(Number((await pool.query("select count(*) n from public.fin_bank_transactions where account_id = $1", [chk])).rows[0].n)).toBe(3);
    await applyMigration(pool, "20261226001000_tax_banking.sql");
    await applyMigration(pool, "20261226001000_tax_banking.sql");   // idempotent
    expect((await pool.query("select count(*)::int n from public.tax_authorities")).rows[0].n).toBe(51);
  });
});
