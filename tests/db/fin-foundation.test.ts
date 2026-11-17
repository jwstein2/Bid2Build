/**
 * Financial Command Center Phase 1, foundation + costs, against the real SQL:
 *   - permission keys / role presets match the TypeScript mirrors; permission matrix by seat role,
 *     PM view-only without a seat, free read-only accountant seat, lapsed add-on = read-only
 *   - entitlement + seat limits (solo 1; company 3 + extras; the accountant seat doesn't count)
 *   - cross-book isolation, append-only audit log, gapless numbering under concurrency
 *   - AI preferences default OFF; dashboard essential alerts / locks; Contractor vs Accountant mode
 *   - costs: budget from the contract version, commitment relief without double counting, duplicate bills,
 *     needs-review queue, profitability labels, a trade switch never rewrites history
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { asFn, fails, lapse, finAddon, n, rowsFn, setupWorld, wonBid, type World } from "./fin-fixtures";
import { OWNER_ONLY_PERMISSIONS, PERMISSION_KEYS } from "@/lib/enterprise/permissions";
import { FIN_PERMISSION_KEYS, FIN_ROLE_PERMISSIONS } from "@/lib/financials/permissions";
import { ESSENTIAL_ALERT_KEYS } from "@/lib/financials/profiles";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

d("Financial Command Center: foundation and costs (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let job: string;
  let est: { id: string; v1: string };

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_fin_foundation"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.book, w.bk]);
    await as(w.owner, "select public.fin_seat_assign($1, $2, 'sales_rep')", [w.book, w.rep]);
    est = await wonBid(pool, w.owner, w.company);
    job = (await as<{ r: Row }>(w.owner, "select public.fin_job_open($1, $2) as r", [est.id, est.v1])).r.jobId;
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("permission catalog and role presets match the TypeScript mirrors", async () => {
    expect((await pool.query("select public.company_permission_keys() as k")).rows[0].k).toEqual([...PERMISSION_KEYS]);
    expect((await pool.query("select public.company_owner_only_permissions() as k")).rows[0].k).toEqual([...OWNER_ONLY_PERMISSIONS]);
    expect((await pool.query("select public.fin_permission_keys() as k")).rows[0].k).toEqual([...FIN_PERMISSION_KEYS]);
    for (const [role, perms] of Object.entries(FIN_ROLE_PERMISSIONS)) {
      expect((await pool.query("select public.fin_role_permissions($1) as p", [role])).rows[0].p, role).toEqual([...perms]);
    }
    // No company role gains a financial key by default.
    for (const role of ["manager", "estimator", "viewer"]) {
      const p: string[] = (await pool.query("select public.company_role_permissions($1) as p", [role])).rows[0].p;
      expect(p.filter((k) => (FIN_PERMISSION_KEYS as readonly string[]).includes(k)), role).toEqual([]);
    }
  });

  it("entitlement: company 3 included seats + extras, solo 1; the free accountant seat doesn't count", async () => {
    const ent = async (b: string) => (await pool.query("select * from public.fin_entitlement($1)", [b])).rows[0];
    expect(await ent(w.book)).toMatchObject({ active: true, seat_limit: 3, source: "stripe" });
    expect(await ent(w.soloBook)).toMatchObject({ active: true, seat_limit: 1 });
    // owner + bookkeeper + rep = 3: a fourth paid seat is refused...
    expect(await fails(as(w.owner, "select public.fin_seat_assign($1, $2, 'view_only')", [w.book, w.viewer]))).toBe("seat_limit");
    // ...but the free read-only accountant seat (an outside login) fits.
    await as(w.owner, "select public.fin_accountant_seat_assign($1, 'cpa@outside.test')", [w.book]);
    expect(await as(w.acct, "select public.fin_access($1) as a", [w.book]).then((r) => (r as Row).a)).toMatchObject({ accountantSeat: true, role: "accountant" });
    await finAddon(pool, w.owner, true, 2);
    expect((await ent(w.book)).seat_limit).toBe(5);
    await finAddon(pool, w.owner, true, 0);
    // A solo book has no extra paid seats to give.
    expect(await fails(as(w.solo, "select public.fin_seat_assign($1, $2, 'bookkeeper')", [w.soloBook, w.viewer]))).toBe("solo_book");
    // Delegating financial seats is owner-only.
    expect(await fails(as(w.bk, "select public.fin_seat_assign($1, $2, 'view_only')", [w.book, w.viewer]))).toBe("forbidden");
  });

  it("permission matrix: seat roles, PM view-only without a seat, accountant read-only, outsiders nothing", async () => {
    const can = async (u: string, key: string, write = false) => (await as<{ c: boolean }>(u, "select public.fin_has_permission($1, $2, $3) as c", [w.book, key, write])).c;
    expect(await can(w.owner, "manage_financial_seats", true)).toBe(true);
    expect(await can(w.bk, "create_invoices", true)).toBe(true);
    expect(await can(w.bk, "approve_vendor_bills", true)).toBe(false);
    expect(await can(w.rep, "view_project_financials")).toBe(true);
    expect(await can(w.rep, "view_company_financials")).toBe(false);
    expect(await can(w.acct, "view_company_financials")).toBe(true);
    expect(await can(w.acct, "export_financials", true)).toBe(false);
    expect(await can(w.viewer, "view_project_financials")).toBe(false);
    expect(await can(w.rival, "view_project_financials")).toBe(false);
    // Granted/revoked company permissions refine the preset.
    await pool.query("update public.company_members set permissions_revoked = '{record_payments}' where user_id = $1", [w.bk]);
    expect(await can(w.bk, "record_payments", true)).toBe(false);
    await pool.query("update public.company_members set permissions_revoked = '{}' where user_id = $1", [w.bk]);

    // The accountant seat reads everything and writes nothing.
    expect((await rows(w.acct, "select id from public.fin_jobs")).length).toBe(1);
    expect(await fails(as(w.acct, "select public.fin_expense_record($1, $2)", [w.book, { amount: "10.00", description: "x" }]))).toBe("forbidden");

    // PM assigned to the job's project: view-only job financials, no paid seat.
    expect((await rows(w.pm, "select id from public.fin_jobs")).length).toBe(0);
    await pool.query(
      `insert into public.project_schedules (estimate_id, user_id, company_id, name, source_snapshot, calendar, start_date, project_manager_id)
       values ($1, $2, $3, 'Deck', '{}', '{"workdays":[1,2,3,4,5],"holidays":[],"timezone":"America/Chicago"}', '2026-11-02', $4)`,
      [est.id, w.owner, w.company, w.pm]);
    expect((await rows(w.pm, "select id from public.fin_jobs")).map((r) => r.id)).toEqual([job]);
    expect((await rows(w.pm, "select * from public.fin_job_contract_v")).length).toBe(1);
    expect(await fails(as(w.pm, "select public.fin_payment_record($1, $2)", [w.book, { amount: "10.00", method: "cash" }]))).toBe("forbidden");
    // Company-wide data (refunds, audit log) stays hidden from a job-only viewer.
    expect((await rows(w.pm, "select id from public.fin_audit_log")).length).toBe(0);
    // A viewer member without a seat sees nothing.
    expect((await rows(w.viewer, "select id from public.fin_jobs")).length).toBe(0);
  });

  it("a lapsed add-on leaves the book readable but read-only", async () => {
    await lapse(pool, w.owner);
    try {
      expect(await fails(as(w.bk, "select public.fin_expense_record($1, $2)", [w.book, { amount: "10.00", description: "Lunch" }]))).toBe("read_only");
      expect((await rows(w.bk, "select id from public.fin_jobs")).length).toBe(1);
      expect(await as(w.owner, "select public.fin_access($1) as a", [w.book]).then((r) => (r as Row).a)).toMatchObject({ active: false, readOnly: true });
    } finally {
      await finAddon(pool, w.owner, true, 0);
    }
    expect(await fails(as(w.bk, "select public.fin_expense_record($1, $2)", [w.book, { amount: "10.00", description: "Lunch" }]))).toBe("ok");
  });

  it("cross-book isolation: another company sees and changes nothing", async () => {
    for (const t of ["fin_jobs", "fin_invoices", "fin_payment_milestones", "fin_budget_lines", "fin_expenses", "fin_cost_codes", "fin_audit_log", "fin_books"]) {
      const r = await rows(w.rival, t === "fin_books" ? "select id as book_id from public.fin_books" : `select book_id from public.${t}`);
      expect(r.every((x) => x.book_id === w.rivalBook), t).toBe(true);
    }
    expect(await fails(as(w.rival, "select public.fin_expense_record($1, $2)", [w.book, { amount: "1.00", description: "x" }]))).toBe("forbidden");
    expect(await fails(as(w.rival, "select public.fin_job_open($1, $2)", [est.id, est.v1]))).toBe("forbidden");
    expect(await fails(as(w.rival, "select public.fin_dashboard_layout($1)", [w.book]))).toBe("forbidden");
  });

  it("audit log is append-only, even for the database owner", async () => {
    const id = (await pool.query("select id from public.fin_audit_log where book_id = $1 limit 1", [w.book])).rows[0].id;
    expect(await fails(pool.query("update public.fin_audit_log set action = 'x' where id = $1", [id]))).toBe("record_immutable");
    expect(await fails(pool.query("delete from public.fin_audit_log where id = $1", [id]))).toBe("record_immutable");
    expect((await rows(w.owner, "select action from public.fin_audit_log where book_id = $1", [w.book])).map((r) => r.action)).toEqual(expect.arrayContaining(["book.created", "seat.assigned", "job.opened"]));
  });

  it("gapless numbering: concurrent calls get consecutive numbers, a rollback leaves no gap", async () => {
    const before = n((await pool.query("select next_value from public.fin_number_sequences where book_id = $1 and doc_type = 'expense'", [w.book])).rows[0]?.next_value ?? 1);
    // A rolled-back transaction doesn't burn a number.
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("select public.fin_next_number($1, 'expense')", [w.book]); await c.query("rollback");
    } finally { c.release(); }
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) =>
      as<{ r: Row }>(w.bk, "select public.fin_expense_record($1, $2) as r", [w.book, { amount: `${i + 1}.00`, description: `Concurrent ${i}` }])));
    const nums = results.map((r) => r.r.number as string).sort();
    const expected = Array.from({ length: 16 }, (_, i) => `EXP-${String(before + i).padStart(4, "0")}`);
    expect(nums).toEqual(expected);
  });

  it("AI preferences: financial toggles are off by default, photo labeling stays on (live today); toggles are independent", async () => {
    const enabled = async (f: string) => (await as<{ e: boolean }>(w.owner, "select public.fin_ai_enabled($1, $2) as e", [w.book, f])).e;
    for (const f of ["expense_suggestions", "document_extraction", "communication_drafting"]) expect(await enabled(f), f).toBe(false);
    expect(await enabled("photo_labeling"), "photo labeling keeps today's behavior with no row").toBe(true);
    expect(await enabled("unknown_feature")).toBe(false);
    await as(w.owner, "select public.fin_ai_preferences_save($1, $2)", [w.book, { documentExtraction: true }]);
    expect(await enabled("document_extraction")).toBe(true);
    for (const f of ["expense_suggestions", "communication_drafting"]) expect(await enabled(f), f).toBe(false);
    expect(await enabled("photo_labeling"), "saving another toggle doesn't turn photo labeling off").toBe(true);
    await as(w.owner, "select public.fin_ai_preferences_save($1, $2)", [w.book, { photoLabeling: false }]);
    expect(await enabled("photo_labeling"), "an explicit OFF sticks").toBe(false);
    expect(await enabled("document_extraction")).toBe(true);
    await as(w.owner, "select public.fin_ai_preferences_save($1, $2)", [w.book, { photoLabeling: true }]);
    expect(await enabled("photo_labeling")).toBe(true);
    const row = (await pool.query("select * from public.fin_ai_preferences where book_id = $1", [w.soloBook])).rows[0];
    expect(row).toBeUndefined();
    expect(await fails(as(w.bk, "select public.fin_ai_preferences_save($1, $2)", [w.book, { photoLabeling: true }]))).toBe("forbidden");
  });

  it("dashboard: company defaults + locks, per-user preferences, essential alerts can't be hidden, restore defaults", async () => {
    await as(w.owner, "select public.fin_dashboard_save($1, 'company', null, $2)", [w.book, { cards: [{ key: "job_profitability" }, { key: "ar_aging" }], lockedCards: ["job_profitability"], kpis: ["collected"] }]);
    await as(w.bk, "select public.fin_dashboard_save($1, 'user', null, $2)", [w.book, {
      cards: [{ key: "overdue_invoices", visible: false }, { key: "job_profitability", visible: false }, { key: "material_costs", visible: false }],
      kpis: ["invoiced"], savedViews: [{ name: "Decks", filters: { trades: ["decks"] } }], collapsedSections: ["costs"] }]);
    const layout = (await as<{ l: Row }>(w.bk, "select public.fin_dashboard_layout($1) as l", [w.book])).l;
    const cards = layout.user.cards as { key: string; visible: boolean }[];
    expect(cards.find((c) => c.key === "overdue_invoices")!.visible).toBe(true);    // essential
    expect(cards.find((c) => c.key === "job_profitability")!.visible).toBe(true);   // locked by the company
    expect(cards.find((c) => c.key === "material_costs")!.visible).toBe(false);
    expect(layout).toMatchObject({ role: "bookkeeper", mode: "contractor", essentialAlerts: [...ESSENTIAL_ALERT_KEYS] });
    expect(layout.company.locked_cards).toEqual(["job_profitability"]);
    // Even a direct write can't store an essential alert hidden.
    expect(await fails(pool.query("insert into public.fin_dashboard_prefs (book_id, scope, user_id, cards) values ($1, 'user', $2, $3)",
      [w.book, w.rep, JSON.stringify([{ key: "needs_review", visible: false }])]))).toBe("essential_alert");
    // Only the owner / manage_financial_config set company defaults; users only their own preferences.
    expect(await fails(as(w.bk, "select public.fin_dashboard_save($1, 'company', null, $2)", [w.book, { cards: [] }]))).toBe("forbidden");
    await as(w.bk, "select public.fin_dashboard_reset($1)", [w.book]);
    expect((await as<{ l: Row }>(w.bk, "select public.fin_dashboard_layout($1) as l", [w.book])).l.user).toBeNull();
    // Users can't read each other's preferences.
    await as(w.rep, "select public.fin_dashboard_save($1, 'user', null, $2)", [w.book, { cards: [] }]);
    expect((await rows(w.bk, "select user_id from public.fin_dashboard_prefs where scope = 'user'")).length).toBe(0);
  });

  it("Contractor Mode by default; Accountant Mode only for authorized users", async () => {
    expect(await fails(as(w.rep, "select public.fin_set_mode($1, 'accountant')", [w.book]))).toBe("forbidden_mode");
    expect(await as<{ m: string }>(w.bk, "select public.fin_set_mode($1, 'accountant') as m", [w.book]).then((r) => r.m)).toBe("accountant");
    expect((await as<{ l: Row }>(w.bk, "select public.fin_dashboard_layout($1) as l", [w.book])).l.mode).toBe("accountant");
    expect((await as<{ l: Row }>(w.rep, "select public.fin_dashboard_layout($1) as l", [w.book])).l.mode).toBe("contractor");
  });

  // ---------------------------------------------------------------------------------------------------------
  it("budget is frozen from the contract version (example rows excluded) with catalog cost codes", async () => {
    const b = await rows(w.owner, `select c.code, l.group_name, l.amount from public.fin_budget_lines l join public.fin_cost_codes c on c.id = l.cost_code_id
                                    where l.job_id = $1 order by c.code`, [job]);
    expect(b.map((r) => [r.code, r.amount])).toEqual([["decks:labor", "400.00"], ["decks:material", "1005.55"], ["electrical:subcontractor", "2000.00"]]);
    expect(await fails(pool.query("update public.fin_budget_lines set amount = 1 where job_id = $1", [job]))).toBe("record_immutable");
  });

  it("commitments are relieved by approved bills with no double counting; duplicates and overruns are caught", async () => {
    const res = (await pool.query("insert into public.pm_resources (company_id, kind, name, email) values ($1, 'subcontractor', 'Sparky Electric', 'sparky@example.test') returning id", [w.company])).rows[0].id;
    const rivalRes = (await pool.query("insert into public.pm_resources (company_id, kind, name) values ($1, 'subcontractor', 'Not yours') returning id", [w.rivalCompany])).rows[0].id;
    expect(await fails(as(w.bk, "select public.fin_vendor_save($1, $2)", [w.book, { resourceId: rivalRes }]))).toBe("resource_scope");
    const vendor = (await as<{ v: string }>(w.bk, "select public.fin_vendor_save($1, $2) as v", [w.book, { resourceId: res }])).v;
    expect((await pool.query("select name, kind from public.fin_vendors where id = $1", [vendor])).rows[0]).toEqual({ name: "Sparky Electric", kind: "subcontractor" });
    const code = (await pool.query("select id from public.fin_cost_codes where book_id = $1 and code = 'electrical:subcontractor'", [w.book])).rows[0].id;
    const cm = (await as<{ r: Row }>(w.bk, "select public.fin_commitment_create($1, $2, 'cm-key-0001') as r", [w.book, { jobId: job, vendorId: vendor, costCodeId: code, title: "Wiring", amount: "5000.00" }])).r;
    // Idempotent replay returns the same commitment.
    expect((await as<{ r: Row }>(w.bk, "select public.fin_commitment_create($1, $2, 'cm-key-0001') as r", [w.book, { jobId: job, vendorId: vendor, costCodeId: code, title: "Wiring", amount: "5000.00" }])).r)
      .toMatchObject({ commitmentId: cm.commitmentId, replayed: true });
    const bill = (await as<{ r: Row }>(w.bk, "select public.fin_bill_record($1, $2) as r", [w.book, {
      vendorId: vendor, vendorInvoiceNumber: "SP-100", billDate: "2026-11-10", lines: [{ commitmentId: cm.commitmentId, description: "Rough-in", amount: "2000.00" }] }])).r;
    const budget = async () => (await rows(w.owner, "select estimated, committed, actual from public.fin_job_budget_v where job_id = $1 and code = 'electrical:subcontractor'", [job]))[0];
    // Pending bill: still committed, not actual.
    expect(await budget()).toEqual({ estimated: "2000.00", committed: "5000.00", actual: "0" });
    expect(await fails(as(w.bk, "select public.fin_bill_approve($1)", [bill.billId]))).toBe("forbidden");
    await as(w.owner, "select public.fin_bill_approve($1)", [bill.billId]);
    expect(await budget()).toEqual({ estimated: "2000.00", committed: "3000.00", actual: "2000.00" });   // 5000 total, counted once
    // The same vendor invoice can't be entered twice.
    expect(await fails(as(w.bk, "select public.fin_bill_record($1, $2)", [w.book, { vendorId: vendor, vendorInvoiceNumber: " sp-100 ", lines: [{ jobId: job, costCodeId: code, description: "dup", amount: "1.00" }] }]))).toBe("duplicate_bill");
    // Billing past the commitment opens a review item; voiding the bill restores the relief and resolves it.
    const big = (await as<{ r: Row }>(w.bk, "select public.fin_bill_record($1, $2) as r", [w.book, {
      vendorId: vendor, vendorInvoiceNumber: "SP-101", lines: [{ commitmentId: cm.commitmentId, description: "Finish", amount: "3500.00" }] }])).r;
    expect((await pool.query("select status from public.fin_review_items where kind = 'commitment_overrun' and entity_id = $1", [cm.commitmentId])).rows.map((r) => r.status)).toEqual(["open"]);
    await as(w.owner, "select public.fin_bill_void($1, 'entered twice')", [big.billId]);
    expect((await pool.query("select status from public.fin_review_items where kind = 'commitment_overrun' and entity_id = $1", [cm.commitmentId])).rows.map((r) => r.status)).toEqual(["resolved"]);
    expect(await budget()).toEqual({ estimated: "2000.00", committed: "3000.00", actual: "2000.00" });
    // Approved bills are immutable.
    expect(await fails(pool.query("update public.fin_vendor_bills set total = 1 where id = $1", [bill.billId]))).toBe("record_immutable");
    expect(await fails(pool.query("delete from public.fin_vendor_bill_lines where bill_id = $1", [bill.billId]))).toBe("record_immutable");
    // Revisions change the commitment, never the original row.
    await as(w.bk, "select public.fin_commitment_revise($1, '500.00', 'Extra circuit')", [cm.commitmentId]);
    expect(await budget()).toMatchObject({ committed: "3500.00" });
  });

  it("expenses: uncoded / missing-receipt items go to the review queue and resolve when filled in", async () => {
    const x = (await as<{ r: Row }>(w.bk, "select public.fin_expense_record($1, $2) as r", [w.book, { jobId: job, amount: "84.20", description: "Lumber run" }])).r;
    const open = async () => (await pool.query("select kind from public.fin_review_items where entity_id = $1 and status = 'open' order by kind", [x.expenseId])).rows.map((r) => r.kind);
    expect(await open()).toEqual(["missing_receipt", "uncoded_cost"]);
    const code = (await pool.query("select id from public.fin_cost_codes where book_id = $1 and code = 'decks:material'", [w.book])).rows[0].id;
    await as(w.bk, "select public.fin_cost_fill('expense', $1, $2)", [x.expenseId, { costCodeId: code }]);
    expect(await open()).toEqual(["missing_receipt"]);
    // A cost code can be filled in once, never changed.
    expect(await fails(as(w.bk, "select public.fin_cost_fill('expense', $1, $2)", [x.expenseId, { costCodeId: code }]))).toBe("already_set");
    expect(await fails(as(w.bk, "select public.fin_expense_decide($1, 'approve')", [x.expenseId]))).toBe("forbidden");
    await as(w.owner, "select public.fin_expense_decide($1, 'approve')", [x.expenseId]);
    const p = (await rows(w.owner, "select * from public.fin_job_profitability_v where job_id = $1", [job]))[0];
    expect(p).toMatchObject({ contract_value: "40000.00", estimated_cost: "3405.55", committed_cost: "3500.00", actual_cost: "2084.20" });
    expect(Object.keys(p)).toEqual(expect.arrayContaining(["estimated_cost", "committed_cost", "actual_cost", "estimated_profit", "projected_profit", "actual_profit_to_date"]));
  });

  it("switching trades adds codes but never changes recorded history", async () => {
    const snapshot = async () => (await pool.query(
      `select l.id, l.cost_code_id, c.code, l.amount from public.fin_budget_lines l join public.fin_cost_codes c on c.id = l.cost_code_id where l.book_id = $1 order by l.id`, [w.book])).rows;
    const codesBefore = (await pool.query("select id, code, name from public.fin_cost_codes where book_id = $1 order by code", [w.book])).rows;
    const histBefore = await snapshot();
    await as(w.owner, "select public.fin_business_config_save($1, $2)", [w.book, { primaryTradeSlug: "decks", presetKey: "deck" }]);
    await as(w.owner, "select public.fin_business_config_save($1, $2)", [w.book, { primaryTradeSlug: "hvac", additionalTradeSlugs: ["plumbing"], presetKey: "hvac" }]);
    expect(await snapshot()).toEqual(histBefore);
    const codesAfter = (await pool.query("select id, code, name from public.fin_cost_codes where book_id = $1 order by code", [w.book])).rows;
    for (const c of codesBefore) expect(codesAfter).toContainEqual(c);
    expect(codesAfter.map((c) => c.code)).toEqual(expect.arrayContaining(["hvac:equipment", "plumbing:labor"]));
    expect(await fails(as(w.owner, "select public.fin_business_config_save($1, $2)", [w.book, { primaryTradeSlug: "not-a-trade" }]))).toBe("unknown_trade");
    expect(await fails(pool.query("update public.fin_cost_codes set code = 'x:material' where book_id = $1 and code = 'decks:material'", [w.book]))).toBe("record_immutable");
    // Project override is presentation only.
    await as(w.owner, "select public.fin_project_profile_save($1, $2)", [est.id, { primaryTradeSlug: "roofing", workflow: "commercial" }]);
    expect(await snapshot()).toEqual(histBefore);
  });
});
