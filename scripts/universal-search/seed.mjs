// Universal search demo world (TEST DATA ONLY, never production). Used by tests/db/universal-search.test.ts and the
// browser walk (scripts/universal-search/setup-db.mjs). Everything goes through the real tables (and the real
// Financials functions for jobs, invoices, payments, bills, expenses and the sandbox), so search reads exactly
// what the app would.
//
//   Summit Exteriors LLC (owner ME, manager Pam, estimator Rae, crew member Cris with no Financials seat)
//     - one bid for each of the 38 trades (customer + estimate), "Johnson Kitchen Remodel" #1042 as a project with
//       PM / sales rep, tasks, trade scope, change orders #1/#2, a signed proposal v2, photos, a customer message
//     - Financials: job, issued invoices (one overdue), a payment, a vendor bill, an expense; a practice (sandbox)
//       book with its own SBX- invoice
//     - people / subs / supplier (with an account number that must never show), saved items with SKUs, an assembly,
//       an employee with a pay rate that must never show
//   Rival Builders (another company) with its own "Michael Johnson" / "Johnson Kitchen Remodel" #1042 and invoice
//   A solo contractor with a "Johnson Deck" bid
import { createHash } from "node:crypto";

export const TRADES = [
  ["roofing", "Roofing"], ["siding", "Siding"], ["decks", "Decks"], ["concrete", "Concrete"], ["kitchens", "Kitchens"], ["bathrooms", "Bathrooms"],
  ["interior-remodeling", "Interior Remodeling"], ["exterior-remodeling", "Exterior Remodeling"], ["drywall", "Drywall"], ["painting", "Painting"],
  ["electrical", "Electrical"], ["plumbing", "Plumbing"], ["hvac", "HVAC"], ["flooring", "Flooring"], ["tile", "Tile"], ["framing", "Framing"],
  ["finish-carpentry", "Finish Carpentry"], ["cabinets-countertops", "Cabinets & Countertops"], ["windows-doors", "Windows & Doors"],
  ["insulation", "Insulation"], ["gutters", "Gutters"], ["fencing", "Fencing"], ["landscaping", "Landscaping"], ["tree-removal", "Tree Removal"], ["tree-trimming", "Tree Trimming"], ["pressure-washing", "Pressure Washing"],
  ["soft-washing", "Soft Washing"], ["pest-control", "Pest Control"], ["excavation", "Excavation"], ["foundations", "Foundations"], ["masonry", "Masonry"], ["asphalt-paving", "Asphalt Paving"],
  ["demolition", "Demolition"], ["basements", "Basements"], ["additions", "Additions"], ["garages", "Garages"], ["pole-barns", "Pole Barns"],
  ["commercial-remodeling", "Commercial Remodeling"], ["general-contracting", "General Contracting"], ["handyman", "Handyman"], ["other", "Other"],
];
const SURNAMES = ["Anderson", "Baker", "Carter", "Diaz", "Evans", "Foster", "Garcia", "Hughes", "Ingram", "Jensen", "Keller", "Lopez", "Morgan",
  "Nguyen", "Olsen", "Patel", "Quinn", "Reyes", "Sullivan", "Turner", "Underwood", "Vasquez", "Walsh", "Xu", "Young", "Zimmer", "Abbott", "Bishop",
  "Coleman", "Dalton", "Ellison", "Fischer", "Grant", "Holloway", "Irwin", "Jacobs", "Kendall", "Lindqvist",
  "Mercer", "Novak", "Ortega", "Prescott", "Ramsey", "Stanton", "Thorne", "Vance"]; // one per trade (42 trades as of Nov 2026)

export const IDS = {
  ME: "00000000-0000-4000-8000-000000000001",
  PAM: "00000000-0000-4000-8000-0000000000a1",
  RAE: "00000000-0000-4000-8000-0000000000a2",
  CRIS: "00000000-0000-4000-8000-0000000000a3",
  RIVAL: "00000000-0000-4000-8000-0000000000b1",
  SOLO: "00000000-0000-4000-8000-0000000000c1",
};
const h = (s) => createHash("sha256").update(s).digest("hex");

/** `pool` is a pg Pool or Client. Returns the ids the tests and the walk use. */
export async function seedSearchWorld(pool, opts = {}) {
  const q = (sql, args = []) => pool.query(sql, args);
  const one = async (sql, args = []) => (await q(sql, args)).rows[0];
  const as = async (u, sql, args = []) => {
    const c = typeof pool.connect === "function" && pool.totalCount !== undefined ? await pool.connect() : pool;
    try {
      await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
      const r = await c.query(sql, args); await c.query("commit"); return r.rows[0];
    } catch (e) { await c.query("rollback"); throw e; } finally { if (c !== pool) c.release(); }
  };
  const { ME, PAM, RAE, CRIS, RIVAL, SOLO } = IDS;
  await q(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'ux-test@built2bid.test', now()), ($2, 'pam@summit.test', now()),
    ($3, 'rae@summit.test', now()), ($4, 'cris@summit.test', now()), ($5, 'boss@rival.test', now()), ($6, 'solo@solo.test', now())`, [ME, PAM, RAE, CRIS, RIVAL, SOLO]);
  const company = (await one("select public.create_company($1, 'Summit Exteriors LLC') as id", [ME])).id;
  const rivalCompany = (await one("select public.create_company($1, 'Rival Builders') as id", [RIVAL])).id;
  await q("insert into public.company_members (company_id, user_id, role, display_name) values ($1, $2, 'manager', 'Pam Manager'), ($1, $3, 'estimator', 'Rae Estimator'), ($1, $4, 'viewer', 'Cris Carpenter')", [company, PAM, RAE, CRIS]);
  const subscribe = (u, plan, co, seats) => q(`select public.apply_subscription_update(p_user_id => $1::uuid, p_stripe_customer_id => 'cus_' || $1, p_stripe_subscription_id => 'sub_' || $1,
      p_status => 'active', p_plan => $2, p_price_id => 'price_x', p_current_period_end => '2099-01-01'::timestamptz, p_cancel_at_period_end => false,
      p_canceled_at => null, p_ended_at => null, p_event_created => now() - interval '1 minute', p_company_id => $3::uuid, p_seat_quantity => $4)`, [u, plan, co, seats]);
  await subscribe(ME, "enterprise", company, 6);
  await subscribe(RIVAL, "enterprise", rivalCompany, 3);
  await subscribe(SOLO, "monthly", null, null);
  for (const u of [ME, RIVAL]) await q("select public.apply_fin_update('sub_' || $1, true, 0, now())", [u]);
  const book = (await as(ME, "select public.fin_my_book() as b")).b;
  const rivalBook = (await as(RIVAL, "select public.fin_my_book() as b")).b;

  const customer = async (u, co, name, extra = {}) => (await one(
    "insert into public.customers (user_id, company_id, name, email, phone, project_address, company_name) values ($1, $2, $3, $4, $5, $6, $7) returning id",
    [u, co, name, extra.email ?? null, extra.phone ?? null, extra.address ?? null, extra.companyName ?? null])).id;
  const estimate = async (u, co, cust, title, extra = {}) => (await one(
    `insert into public.estimates (user_id, company_id, customer_id, title, customer_name, customer_email, customer_phone, project_address, trades, estimate_number, customer_notes, location_city, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $1) returning id`,
    [u, co, cust, title, extra.customerName ?? "", extra.email ?? null, extra.phone ?? null, extra.address ?? null, extra.trades ?? [], extra.number ?? "",
      extra.notes ?? null, extra.city ?? null])).id;
  const setStage = async (id, stage) => {
    const c = typeof pool.connect === "function" && pool.totalCount !== undefined ? await pool.connect() : pool;
    try { await c.query("begin"); await c.query("select set_config('app.stage_change', 'on', true)"); await c.query("update public.estimates set pipeline_stage = $2 where id = $1", [id, stage]); await c.query("commit"); }
    finally { if (c !== pool) c.release(); }
  };
  const version = async (id, u, n, total = "48000.00") => (await one(
    `insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total)
     values ($1, $2, $3, $4, $5, $6, 30000, $7, 0, $7) returning id`,
    [id, u, n, h(`${id}v${n}`), { schema: 1, estimate: { trades: ["kitchens", "electrical"], groups: [{ id: "g1", name: "Cabinets", trade: "kitchens" }, { id: "g2", name: "Electrical", trade: "electrical" }],
      items: [{ id: "i1", groupId: "g1", costType: "material", quantity: "1", unitCost: "18000" }, { id: "i2", groupId: "g2", costType: "subcontractor", quantity: "1", unitCost: "12000" }] } },
     { paymentSchedule: [{ label: "Deposit", percent: "30", amount: "$0.00" }, { label: "Rough-in", percent: "30", amount: "$0.00" }, { label: "Completion", percent: "40", amount: "$0.00" }] }, total])).id;

  // One bid for each of the 38 trades.
  const tradeBids = {};
  for (const [i, [slug, label]] of TRADES.entries()) {
    const name = `${["Alex", "Jordan", "Casey", "Morgan", "Riley", "Taylor"][i % 6]} ${SURNAMES[i]}`;
    const cust = await customer(ME, company, name, { email: `${SURNAMES[i].toLowerCase()}@example.test`, address: `${100 + i} Oak Ave, Minneapolis MN` });
    tradeBids[slug] = await estimate(ME, company, cust, `${SURNAMES[i]} ${label} project`, { customerName: name, trades: [slug], number: String(2000 + i), address: `${100 + i} Oak Ave, Minneapolis MN`, city: "Minneapolis" });
  }

  // The Johnson scenario.
  const johnson = await customer(ME, company, "Michael Johnson", { email: "mjohnson@example.test", phone: "(612) 555-0142", address: "410 Lakeview Dr, Edina MN" });
  const johnston = await customer(ME, company, "Sarah Johnston", { email: "sarah.j@example.test", address: "88 Birch Ln, Edina MN" });
  const kitchen = await estimate(ME, company, johnson, "Johnson Kitchen Remodel", { customerName: "Michael Johnson", email: "mjohnson@example.test", phone: "(612) 555-0142",
    address: "410 Lakeview Dr, Edina MN", trades: ["kitchens", "electrical", "plumbing"], number: "1042", notes: "Full gut remodel with island and new lighting.", city: "Edina" });
  const g1 = (await one("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Cabinets', 1) returning id", [kitchen, ME])).id;
  const g2 = (await one("insert into public.estimate_groups (estimate_id, user_id, name, sort_order) values ($1, $2, 'Electrical', 2) returning id", [kitchen, ME])).id;
  await q("insert into public.estimate_items (estimate_id, group_id, user_id, name, description, cost_type, quantity, unit, unit_cost, sort_order) values ($1, $2, $3, 'Shaker base cabinets', 'Painted maple', 'material', 14, 'ea', 450, 1), ($1, $4, $3, '200A panel upgrade', 'Replace 100A panel', 'subcontractor', 1, 'ea', 3800, 1)", [kitchen, g1, ME, g2]);
  const v1 = await version(kitchen, ME, 1, "46000.00");
  const v2 = await version(kitchen, ME, 2);
  await setStage(kitchen, "won");
  const bath = await estimate(ME, company, johnston, "Johnston Bathroom Refresh", { customerName: "Sarah Johnston", trades: ["bathrooms"], number: "1043" });
  await estimate(ME, company, null, "Whitfield Garage Roof", { customerName: "Dana Whitfield", trades: ["roofing", "garages"], number: "1050", notes: "Tear-off and re-shingle detached garage." });
  await estimate(RAE, company, null, "Lakeview Condo Electrical", { customerName: "Lakeview HOA", trades: ["electrical"], number: "1061" });

  // Signed proposal v2.
  const req = (await one(`insert into public.signing_requests (estimate_id, version_id, user_id, token_hash, document_hash, content_hash, status, expires_at)
    values ($1, $2, $3, $4, $5, $6, 'signed', now() + interval '30 days') returning id`, [kitchen, v2, ME, h("tok-kitchen"), h("doc-kitchen"), h("content-kitchen")])).id;
  const signature = (await one(`insert into public.signatures (request_id, estimate_id, version_id, user_id, company_id, signer_name, signer_email, method, signature_text,
      consent_version, consent_text, acceptance_text, consented_at, document_hash, content_hash, total, version_number, proposal_number, project_title, customer_name)
    values ($1, $2, $3, $4, $5, 'Michael Johnson', 'mjohnson@example.test', 'typed', 'Michael Johnson', 'v1', 'I agree to sign electronically.', 'I accept this proposal.', now(),
      $6, $7, 48000, 2, '1042', 'Johnson Kitchen Remodel', 'Michael Johnson') returning id`, [req, kitchen, v2, ME, company, h("doc-kitchen"), h("content-kitchen")])).id;

  // Project schedule, tasks and trade scope.
  const schedule = (await one(`insert into public.project_schedules (estimate_id, user_id, company_id, name, source_snapshot, calendar, start_date, status, project_manager_id, sales_rep_id, source_version_id)
    values ($1, $2, $3, 'Johnson Kitchen Remodel', '{}'::jsonb, '{"workdays":[1,2,3,4,5],"holidays":[],"timezone":"America/Chicago"}'::jsonb, current_date, 'active', $4, $5, $6) returning id`,
    [kitchen, ME, company, PAM, RAE, v2])).id;
  await setStage(kitchen, "scheduled");
  const res = async (co, kind, name, extra = {}) => (await one(
    "insert into public.pm_resources (company_id, kind, name, contact_name, trades, email, phone, linked_user_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
    [co, kind, name, extra.contact ?? null, extra.trades ?? [], extra.email ?? null, extra.phone ?? null, extra.linked ?? null])).id;
  const bright = await res(company, "subcontractor", "Bright Electric", { contact: "Lena Bright", trades: ["electrical"], email: "office@brightelectric.test", phone: "612-555-0199" });
  const stone = await res(company, "subcontractor", "Stone Works LLC", { contact: "Sam Stone", trades: ["cabinets-countertops"], email: "sam@stoneworks.test" });
  const jose = await res(company, "staff", "Jose Martinez", { trades: ["framing", "finish-carpentry"], phone: "612-555-0177" });
  const crisRes = await res(company, "staff", "Cris Carpenter", { trades: ["finish-carpentry"], linked: CRIS });
  await q("insert into public.pm_employee_profiles (resource_id, title, pay_type, hourly_cost) values ($1, 'Lead carpenter', 'hourly', 38.50)", [jose]);
  const task = async (name, kind, parent, extra = {}) => (await one(
    `insert into public.schedule_tasks (schedule_id, parent_id, kind, source_group_id, source_item_id, name, sort_order, planned_start, planned_end, duration_days, status, assignee, resource_id)
     values ($1, $2, $3, gen_random_uuid(), $4, $5, $6, current_date + $7::int, current_date + $7::int + 2, 3, $8, $9, $10) returning id`,
    [schedule, parent, kind, kind === "item" ? extra.item ?? crypto.randomUUID() : null, name, extra.sort ?? 0, extra.offset ?? 0, extra.status ?? "not_started", extra.assignee ?? null, extra.resource ?? null])).id;
  const secDemo = await task("Demolition", "section", null, { sort: 1 });
  const demo = await task("Remove existing cabinets", "item", secDemo, { sort: 2, assignee: "Jose Martinez", resource: jose, status: "in_progress" });
  const secElec = await task("Electrical", "section", null, { sort: 3, offset: 5 });
  const roughIn = await task("Rough-in wiring", "item", secElec, { sort: 4, offset: 5, resource: bright });
  const secCab = await task("Cabinets", "section", null, { sort: 5, offset: 10 });
  const cabinets = await task("Install base cabinets", "item", secCab, { sort: 6, offset: 10, assignee: "Cris Carpenter", resource: crisRes });
  const scope = (await one(`insert into public.project_scope_sections (estimate_id, user_id, company_id, source_group_id, trade, title, sort_order, approved_scope, work_description, internal_notes)
    values ($1, $2, $3, gen_random_uuid(), 'electrical', 'Electrical', 1, 'Install 200A panel, 12 recessed lights and under-cabinet lighting', 'Pull permit; rough-in before drywall', 'Margin is thin on this one') returning id`, [kitchen, ME, company])).id;
  const co1 = (await one("insert into public.change_orders (estimate_id, user_id, company_id, number, title, description, amount, status, internal_notes) values ($1, $2, $3, 1, 'Upgrade countertops to quartz', 'Swap laminate for quartz', 2400, 'draft', 'secret-internal-note') returning id", [kitchen, ME, company])).id;
  const co2 = (await one(`insert into public.change_orders (estimate_id, user_id, company_id, number, title, description, amount, status, approval_method, approval_note, approved_version, decided_at, version)
    values ($1, $2, $3, 2, 'Add pantry outlets', 'Two 20A outlets in the pantry', 650, 'approved', 'manual', 'Approved on site', 1, now(), 1) returning id`, [kitchen, ME, company])).id;
  const photo = (await one(`insert into public.project_photos (user_id, company_id, customer_id, estimate_id, storage_path, content_type, bytes, caption, labels, ai_labels, ai_status)
    values ($1, $2, $3, $4, 'p/panel.jpg', 'image/jpeg', 1000, 'Panel before upgrade', '{electrical panel}', '{water damage}', 'suggested') returning id`, [ME, company, johnson, kitchen])).id;
  const message = (await one(`insert into public.comm_messages (account_id, kind, trigger, customer_id, estimate_id, schedule_id, to_email, to_name, subject, body_text, status, idempotency_key)
    values ($1, 'project_update', 'weekly', $2, $3, $4, 'mjohnson@example.test', 'Michael Johnson', 'Your kitchen remodel this week', 'PRIVATE-BODY-TEXT', 'sent', 'search-seed-1') returning id`, [company, johnson, kitchen, schedule])).id;

  // Supplier directory and pricing library.
  const supplier = (await one("insert into public.pm_suppliers (company_id, name, account_number, rep_name, email, phone, trades) values ($1, 'ABC Supply Co', 'ACCT-SECRET-991', 'Tony Ruiz', 'tony@abcsupply.test', '612-555-0110', '{roofing,siding}') returning id", [company])).id;
  const shingle = (await one(`insert into public.saved_items (user_id, company_id, name, description, cost_type, unit, unit_cost, trade, category, supplier_name, supplier_sku)
    values ($1, $2, 'Architectural shingles 30-year Black', 'Bundle, 33.3 sq ft', 'material', 'bundle', 41.75, 'roofing', 'Shingles', 'ABC Supply Co', 'SHG-30-BLK') returning id`, [ME, company])).id;
  const romex = (await one(`insert into public.saved_items (user_id, company_id, name, description, cost_type, unit, unit_cost, trade, category, supplier_name, supplier_sku)
    values ($1, $2, 'Romex 12/2 NM-B 250 ft', 'Copper building wire', 'material', 'roll', 189.00, 'electrical', 'Wire', 'Home Depot', 'RMX-122-250') returning id`, [ME, company])).id;
  const assembly = (await one("insert into public.assemblies (user_id, company_id, name, description, trade) values ($1, $2, 'Kitchen electrical rough-in', 'Panel, circuits and boxes per kitchen', 'electrical') returning id", [ME, company])).id;

  // Financials (real functions).
  const job = (await as(ME, "select public.fin_job_open($1, $2) as r", [kitchen, v2])).r.jobId;
  const invoiceIssue = async (u, j, desc, amount, due) => {
    const inv = (await as(u, "select public.fin_invoice_save($1, $2) as r", [j, { kind: "custom", dueDate: due, lines: [{ description: desc, quantity: "1", unitPrice: amount }] }])).r.invoiceId;
    const r = (await as(u, "select public.fin_invoice_issue($1, $2::date) as r", [inv, due < "2026-11-01" ? "2026-09-15" : null])).r;
    return { id: inv, number: r.number };
  };
  const overdue = await invoiceIssue(ME, job, "Deposit", "14400", "2026-10-01");
  const current = await invoiceIssue(ME, job, "Rough-in draw", "9850.25", "2099-12-31");
  const payment = (await as(ME, "select public.fin_payment_record($1, $2) as r", [book, { jobId: job, method: "check", reference: "CHK 5521", amount: "5000.00", allocations: [{ invoiceId: overdue.id, amount: "5000.00" }] }])).r;
  const vendor = (await as(ME, "select public.fin_vendor_save($1, $2) as v", [book, { resourceId: bright }])).v;
  const code = (await one("select id from public.fin_cost_codes where book_id = $1 and code = 'electrical:subcontractor'", [book]))?.id
    ?? (await one("select id from public.fin_cost_codes where book_id = $1 order by code limit 1", [book])).id;
  const bill = (await as(ME, "select public.fin_bill_record($1, $2) as r", [book, { vendorId: vendor, vendorInvoiceNumber: "BE-7781", billDate: "2026-11-10", lines: [{ jobId: job, costCodeId: code, description: "Rough-in labor", amount: "3200.00" }] }])).r;
  const expense = (await as(ME, "select public.fin_expense_record($1, $2) as r", [book, { amount: "84.12", description: "Wire nuts and boxes", payee: "Home Depot", jobId: job, spentOn: "2026-11-12" }])).r;
  // Practice (sandbox) book: entered and left by the owner, with one SBX- invoice.
  const sb = (await as(ME, "select public.fin_sandbox_enter($1) as r", [book])).r.sandboxBookId;
  const sbJob = (await one("select id from public.fin_jobs where book_id = $1", [sb])).id;
  const sbInvoice = await invoiceIssue(ME, sbJob, "Practice deposit", "777", "2026-10-15");
  await as(ME, "select public.fin_sandbox_leave()");

  // Rival company: the same names, never visible to Summit.
  const rivalJohnson = await customer(RIVAL, rivalCompany, "Michael Johnson", { email: "mj@rival.test" });
  const rivalKitchen = await estimate(RIVAL, rivalCompany, rivalJohnson, "Johnson Kitchen Remodel", { customerName: "Michael Johnson", trades: ["kitchens"], number: "1042" });
  const rv = await version(rivalKitchen, RIVAL, 1);
  await setStage(rivalKitchen, "won");
  const rivalJob = (await as(RIVAL, "select public.fin_job_open($1, $2) as r", [rivalKitchen, rv])).r.jobId;
  const rivalInvoice = await invoiceIssue(RIVAL, rivalJob, "Rival deposit", "999", "2026-10-01");
  const rivalSub = await res(rivalCompany, "subcontractor", "Bright Electric (Rival)", { trades: ["electrical"] });
  // Solo contractor.
  const soloCust = await customer(SOLO, null, "Michael Johnson", { email: "mj@solo.test" });
  const soloDeck = await estimate(SOLO, null, soloCust, "Johnson Deck", { customerName: "Michael Johnson", trades: ["decks"], number: "77" });

  if (opts.bulk) await seedBulk(pool, { company, owner: ME, count: opts.bulk });

  return { company, rivalCompany, book, rivalBook, sandboxBook: sb, johnson, johnston, kitchen, bath, v1, v2, signature, schedule, secElec, roughIn, demo, cabinets, scope,
    co1, co2, photo, message, bright, stone, jose, supplier, shingle, romex, assembly, job, overdue, current, payment, vendor, bill, expense, sbInvoice,
    rivalJohnson, rivalKitchen, rivalInvoice, rivalSub, soloDeck, tradeBids };
}

/** Load for the benchmark: `count` extra customers + bids (and 5 tasks each on a schedule per 10 bids) for one company. */
export async function seedBulk(pool, { company, owner, count }) {
  await pool.query(`
    with c as (
      insert into public.customers (user_id, company_id, name, email, project_address)
      select $1, $2, 'Bulk Customer ' || g || ' ' || (array['Smith','Brown','Lee','Wilson','Clark','Hall','Allen','King','Wright','Scott'])[1 + g % 10],
             'bulk' || g || '@example.test', g || ' Elm St, St Paul MN'
        from generate_series(1, $3) g returning id, name)
    insert into public.estimates (user_id, company_id, customer_id, title, customer_name, trades, estimate_number, project_address)
    select $1, $2, c.id, 'Bulk bid ' || row_number() over () || ' ' || (array['deck','roof','kitchen','bath','siding','fence','patio','garage'])[1 + (row_number() over ())::int % 8],
           c.name, array[(array['decks','roofing','kitchens','bathrooms','siding','fencing','concrete','garages'])[1 + (row_number() over ())::int % 8]],
           'B' || (100000 + row_number() over ()), (row_number() over ()) || ' Elm St, St Paul MN'
      from c`, [owner, company, count]);
  await pool.query(`
    with e as (select id, title, row_number() over () n from public.estimates where company_id = $2 and estimate_number like 'B%'),
    s as (insert into public.project_schedules (estimate_id, user_id, company_id, name, source_snapshot, calendar, start_date)
          select e.id, $1, $2, e.title, '{}'::jsonb, '{"workdays":[1,2,3,4,5],"holidays":[],"timezone":"America/Chicago"}'::jsonb, current_date from e where e.n % 10 = 0 returning id)
    insert into public.schedule_tasks (schedule_id, kind, source_group_id, name, planned_start, planned_end, duration_days)
    select s.id, 'section', gen_random_uuid(), (array['Demolition','Framing','Electrical','Plumbing','Finish'])[k], current_date, current_date + 1, 2
      from s cross join generate_series(1, 5) k`, [owner, company]);
  await pool.query("analyze");
}
