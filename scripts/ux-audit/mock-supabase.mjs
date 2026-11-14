// Local stand-in for Supabase used ONLY to render signed-in pages for UX screenshots.
// Answers /auth/v1/user and simple PostgREST reads/RPCs with canned test data. Never point production at it.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const NOW = Date.now();
const iso = (d = 0) => new Date(NOW - d * 864e5).toISOString();
export const USER = {
  id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated",
  email: "ux-test@built2bid.test", email_confirmed_at: iso(30), created_at: iso(30), app_metadata: {}, user_metadata: {},
};
const EST = "11111111-1111-4111-8111-111111111111";
const G = (n) => `22222222-2222-4222-8222-00000000000${n}`;
const item = (n, g, name, cost_type, qty, unit, cost, sort) => ({
  id: `33333333-3333-4333-8333-0000000000${String(n).padStart(2, "0")}`, estimate_id: EST, group_id: G(g), name, description: null, category: null,
  cost_type, treatment: "marked_up", quantity: qty, unit, unit_cost: cost, taxable: true, pricing_mode: null, pricing_percent: null,
  show_on_proposal: true, notes: null, sort_order: sort,
});

const tables = {
  business_profiles: process.env.MOCK_EMPTY_PROFILE ? [] : [{ user_id: USER.id, company_name: "Summit Exteriors LLC", contact_name: "Alex Rivera", email: "office@summit.test", phone: "(555) 010-2030", address: "120 Main St, Springfield", website: null, license_number: "CBC-12345", logo_path: null, accent_color: "#00C2E0", default_terms: null, default_payment_terms: null }],
  estimates: [
    { id: EST, user_id: USER.id, title: "Siding replacement – Johnson residence", customer_name: "Pat Johnson", customer_email: "pat@example.test", customer_phone: null, project_address: "48 Oak Lane", customer_notes: null, trades: ["siding"], status: "draft", updated_at: iso(0), estimate_number: "B-1004", estimate_date: iso(0).slice(0, 10), expiration_date: iso(-30).slice(0, 10), location_zip: null, location_city: null, location_state: null, pricing_mode: "markup", pricing_percent: 25, fixed_adjustment: 0, adjustment_label: null, tax_rate: 0, display_mode: "itemized", default_group_visibility: "itemized", template_trade: "siding", template_version: 1, customer_id: null, proposal_config: null },
    { id: "11111111-1111-4111-8111-111111111112", title: "Deck rebuild – Lee", customer_name: "Morgan Lee", trades: ["decks"], status: "finalized", updated_at: iso(3), estimate_number: "B-1003" },
    { id: "11111111-1111-4111-8111-111111111113", title: "Kitchen remodel with a very long descriptive project title to test wrapping", customer_name: "Sam Ortiz-Washington", trades: ["kitchen-remodeling"], status: "draft", updated_at: iso(8), estimate_number: "B-1002" },
  ],
  estimate_versions: [{ id: "44444444-4444-4444-8444-000000000001", estimate_id: "11111111-1111-4111-8111-111111111112", version_number: 1, total: 18450.5, created_at: iso(3) }],
  estimate_groups: [
    { id: G(1), estimate_id: EST, name: "Tear-off & prep", description: null, visibility: null, sort_order: 0, pricing_mode: null, pricing_percent: null },
    { id: G(2), estimate_id: EST, name: "Siding installation", description: null, visibility: null, sort_order: 1, pricing_mode: null, pricing_percent: null },
    { id: G(3), estimate_id: EST, name: "Trim & accessories", description: null, visibility: null, sort_order: 2, pricing_mode: null, pricing_percent: null },
    { id: G(4), estimate_id: EST, name: "Cleanup & disposal", description: null, visibility: null, sort_order: 3, pricing_mode: null, pricing_percent: null },
  ],
  estimate_items: [
    item(1, 1, "Remove existing siding", "labor", 18, "square", 65, 0),
    item(2, 1, "House wrap", "material", 20, "square", 32, 1),
    item(3, 2, "Vinyl siding panels", "material", 20, "square", 145, 0),
    item(4, 2, "Siding install labor", "labor", 20, "square", 120, 1),
    item(5, 3, "J-channel", "material", 240, "linear foot", 1.1, 0),
  ],
  customers: [{ id: "55555555-5555-4555-8555-000000000001", user_id: USER.id, name: "Pat Johnson", email: "pat@example.test", phone: "(555) 333-4444", address: "48 Oak Lane", notes: null, created_at: iso(10), updated_at: iso(1) }],
  saved_items: [
    { id: "66666666-6666-4666-8666-000000000001", user_id: USER.id, name: "Dumpster rental (20 yd)", cost_type: "equipment", unit: "each", unit_cost: 450, treatment: "marked_up", taxable: true, description: null, trade: null, category: null, quantity: null, created_at: iso(5) },
    { id: "66666666-6666-4666-8666-000000000002", user_id: USER.id, name: "Framing Labor", cost_type: "labor", unit: "square foot", unit_cost: 8, treatment: "marked_up", taxable: false, description: null, trade: "framing", category: "Framing Labor", quantity: null, created_at: iso(4) },
    { id: "66666666-6666-4666-8666-000000000003", user_id: USER.id, name: "Framing Materials", cost_type: "material", unit: "square foot", unit_cost: 10, treatment: "marked_up", taxable: true, description: null, trade: "framing", category: "Framing Materials", quantity: null, created_at: iso(4) },
    { id: "66666666-6666-4666-8666-000000000004", user_id: USER.id, name: "Remove existing siding", cost_type: "labor_material", unit: "square", unit_cost: 70, treatment: "marked_up", taxable: false, description: null, trade: "siding", category: "Tear-off & prep", quantity: null, created_at: iso(3) },
  ],
  assemblies: [], assembly_items: [],
  subscriptions: process.env.MOCK_UNLIMITED ? [{ id: "sub_test", user_id: USER.id, status: "active", plan: "monthly", price_id: "price_test", current_period_end: iso(-20), cancel_at_period_end: false, updated_at: iso(1) }] : [],
  billing_customers: [], profiles: [{ id: USER.id, marketing_opt_in: false, created_at: iso(30) }], market_consent: [],
  estimate_project_profiles: [], trade_templates: [], feature_flags: [], audit_logs: [], import_logs: [], pdf_errors: [],
};
const rpcs = {
  is_admin: process.env.MOCK_ADMIN === "1",
  credit_status: [{ starter_balance: 2, starter_total: 3, monthly_balance: 0, monthly_eligible: false, next_cycle_at: iso(-12), unlimited: Boolean(process.env.MOCK_UNLIMITED), email_verified: true, starter_granted: true }],
  save_estimate: { id: EST }, market_log_view: null,
  // Saved Items & Pricing Library entitlement (Unlimited or admin).
  library_access: Boolean(process.env.MOCK_UNLIMITED) || process.env.MOCK_ADMIN === "1",
};

// Account scenarios for the account-aware CTA checks (scripts/account-ctas/run.mjs). Switch at runtime with
// GET /__scenario?name=<key>&authDelayMs=<n>. MOCK_UNLIMITED keeps its old meaning for the UX audit scripts.
const sub = (o) => [{ stripe_subscription_id: "sub_test", id: "sub_test", user_id: USER.id, status: "active", plan: "monthly", price_id: "price_test", current_period_end: iso(-20), cancel_at_period_end: false, canceled_at: null, ended_at: null, updated_at: iso(1), ...o }];
const COMPANY = "55555555-5555-4555-8555-000000000001";
const ALL_PERMS = ["view_own_bids", "view_team_bids", "view_company_bids", "create_estimates", "edit_team_estimates", "view_costs", "view_margin", "approve_bids", "manage_company_pricing", "view_analytics", "manage_teams", "manage_users", "manage_billing"];
const company = (role, o) => ({ id: COMPANY, name: "Summit Exteriors LLC", role, isOwner: role === "owner", permissions: role === "owner" ? ALL_PERMS : ["view_own_bids", "create_estimates", "view_costs"], entitlement: { active: true, source: "stripe", seatLimit: 5, expiresAt: null }, seatsUsed: 3, ...o });
const credit = (o) => [{ starter_balance: 2, starter_total: 3, monthly_balance: 0, monthly_eligible: false, next_cycle_at: iso(-12), unlimited: false, email_verified: true, starter_granted: true, ...o }];
export const SCENARIOS = {
  starter: { credit: credit({}), subs: [] },
  monthly: { credit: credit({ starter_balance: 0, monthly_balance: 1, monthly_eligible: true }), subs: [] },
  unlimited: { credit: credit({ unlimited: true }), subs: sub({}) },
  canceling: { credit: credit({ unlimited: true }), subs: sub({ cancel_at_period_end: true, canceled_at: iso(2) }) },
  expired: { credit: credit({ starter_balance: 0, monthly_balance: 0, monthly_eligible: true }), subs: sub({ status: "canceled", current_period_end: iso(3), ended_at: iso(3), canceled_at: iso(30) }) },
  zero: { credit: credit({ starter_balance: 0, monthly_balance: 0, monthly_eligible: true }), subs: [] },
  // Enterprise: owner with 5 licensed users (4 in use), a member without billing rights, a complimentary company.
  enterprise_owner: { credit: credit({ unlimited: true }), subs: sub({ plan: "enterprise", company_id: COMPANY, seat_quantity: 5, price_id: "price_ent_base" }), company: company("owner", { seatsUsed: 4, entitlement: { active: true, source: "stripe", seatLimit: 5, expiresAt: iso(-20) } }) },
  enterprise_estimator: { credit: credit({ unlimited: true }), subs: [], company: company("estimator", {}) },
  enterprise_comp: { credit: credit({ unlimited: true }), subs: [], company: company("owner", { entitlement: { active: true, source: "complimentary", seatLimit: 3, expiresAt: iso(-30) } }) },
  enterprise_past_due: { credit: credit({ unlimited: true }), subs: sub({ status: "past_due", plan: "enterprise", company_id: COMPANY, seat_quantity: 5 }), company: company("owner", { seatsUsed: 4, entitlement: { active: true, source: "stripe", seatLimit: 5, expiresAt: iso(-20) } }) },
};
const LIBRARY_SEED = JSON.stringify({ saved_items: tables.saved_items, assemblies: tables.assemblies, assembly_items: tables.assembly_items });
let authDelayMs = 0;
const otpLog = [];
const KNOWN_PHONES = new Set(["15552345678"]);
const TAKEN_PHONE = "15559990000";
function applyScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) return false;
  rpcs.credit_status = sc.credit;
  tables.subscriptions = sc.subs;
  rpcs.library_access = Boolean(sc.credit[0].unlimited);
  rpcs.my_company = sc.company ?? null;
  rpcs.company_billing_summary = sc.company ? { activeMembers: Math.max(1, (sc.company.seatsUsed ?? 1) - 1) } : null;
  // Users & Permissions page data (owner sees emails, deactivated people and invitations).
  const owner = sc.company?.role === "owner";
  const TEAM = "55555555-5555-4555-8555-0000000000a1";
  const M2 = "00000000-0000-4000-8000-000000000002", M3 = "00000000-0000-4000-8000-000000000003", M4 = "00000000-0000-4000-8000-000000000004";
  rpcs.company_roster = sc.company ? [
    { user_id: USER.id, display_name: "Jordan Owner", email: USER.email, role: sc.company.role, status: "active", team_ids: [], managed_team_ids: [], joined_at: iso(60), last_active_at: iso(0) },
    { user_id: M2, display_name: "Riley Manager", email: owner ? "riley@summit.test" : null, role: "manager", status: "active", team_ids: [TEAM], managed_team_ids: [TEAM], joined_at: iso(40), last_active_at: iso(1) },
    { user_id: M3, display_name: "Casey Estimator", email: owner ? "casey@summit.test" : null, role: "estimator", status: "active", team_ids: [TEAM], managed_team_ids: [], joined_at: iso(20), last_active_at: iso(2) },
    ...(owner ? [{ user_id: M4, display_name: "Pat Former", email: "pat@summit.test", role: "viewer", status: "deactivated", team_ids: [], managed_team_ids: [], joined_at: iso(90), last_active_at: iso(30) }] : []),
  ] : null;
  rpcs.company_member_access = owner ? [{ user_id: M3, permissions_granted: ["view_analytics"], permissions_revoked: [] }] : null;
  rpcs.company_teams_overview = sc.company ? [{ id: TEAM, name: "Siding Crew", trade: "siding", member_count: 2, manager_count: 1 }] : null;
  rpcs.list_company_invitations = owner ? [{ id: "55555555-5555-4555-8555-0000000000b1", email: "newhire@summit.test", role: "estimator", team_id: null, expires_at: iso(-6), created_at: iso(1) }] : null;
  rpcs.peek_company_invitation = [{ company_name: "Summit Exteriors LLC", role: "estimator", email_hint: "u•••@built2bid.test", expires_at: iso(-6), email_matches: true }];
  return true;
}
if (process.env.MOCK_SCENARIO) applyScenario(process.env.MOCK_SCENARIO);

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "content-range" };
const send = (res, code, body, extra = {}) => { res.writeHead(code, { "content-type": "application/json", ...cors, ...extra }); res.end(body === undefined ? "" : JSON.stringify(body)); };

// Complimentary Access browser walk (scripts/complimentary/walk.mjs): when COMP_PG_URL points at a throwaway
// test database with the real migrations, these RPCs run the real SQL there instead of returning canned data.
const COMP_RPC = /^(admin_comp_\w+|my_comp_access|claim_comp_grant_by_token|has_paid_subscription|credit_status|library_access)$/;
const compPool = process.env.COMP_PG_URL ? new (await import("pg")).default.Pool({ connectionString: process.env.COMP_PG_URL, max: 5 }) : null;
const inviteLog = [];
async function compRpc(name, args, res) {
  const keys = Object.keys(args);
  const params = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
  const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
  const setReturning = ["my_comp_access", "credit_status"].includes(name);
  const c = await compPool.connect();
  try {
    await c.query("begin");
    // Functions that read auth.uid() run as the signed-in mock user.
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [USER.id]);
    const r = await c.query(setReturning ? `select * from ${call}` : `select ${call} as v`, params);
    await c.query("commit");
    send(res, 200, setReturning ? r.rows : r.rows[0].v);
  } catch (e) {
    await c.query("rollback").catch(() => {});
    send(res, 400, { code: e.code ?? "P0001", message: e.message, details: null, hint: null });
  } finally { c.release(); }
}

let onboardingMode = "ok";
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.method === "OPTIONS") return send(res, 204);
    if (u.pathname === "/__scenario") {
      authDelayMs = Number(u.searchParams.get("authDelayMs") ?? 0);
      return applyScenario(u.searchParams.get("name") ?? "") ? send(res, 200, { ok: true }) : send(res, 400, { error: "unknown scenario" });
    }
    // Welcome popup tests: set the account's profiles.onboarding_status ("new" = null, "missing" = column not migrated).
    if (u.pathname === "/__onboarding") {
      const st = u.searchParams.get("status");
      if (st) { onboardingMode = st === "missing" ? "missing" : "ok"; tables.profiles[0].onboarding_status = ["existing", "dismissed", "completed"].includes(st) ? st : null; }
      return send(res, 200, { mode: onboardingMode, status: tables.profiles[0].onboarding_status ?? null });
    }
    if (u.pathname === "/rest/v1/profiles" && onboardingMode === "missing" && ((u.searchParams.get("select") ?? "").includes("onboarding") || raw.includes("onboarding"))) {
      return send(res, 400, { code: "42703", message: "column profiles.onboarding_status does not exist" });
    }
    if (u.pathname === "/rest/v1/profiles" && req.method === "PATCH") {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      const p = tables.profiles[0];
      const onlyNull = u.searchParams.get("onboarding_status") === "is.null";
      if (!(onlyNull && p.onboarding_status)) Object.assign(p, body);
      return send(res, 200, [p]);
    }
    if (u.pathname === "/__reset_library") { Object.assign(tables, JSON.parse(LIBRARY_SEED)); return send(res, 200, { ok: true }); }
    if (u.pathname === "/auth/v1/user" && req.method === "GET") return void setTimeout(() => send(res, 200, USER), authDelayMs);
    if (u.pathname === "/__otp-log") {
      if (u.searchParams.get("reset")) otpLog.length = 0;
      return send(res, 200, otpLog);
    }
    // Email/SMS OTP for checkout and sign-in tests: code 123456 succeeds, anything else is "expired or invalid".
    // SMS: numbers in KNOWN_PHONES have accounts; others get Supabase's "Signups not allowed" unless create_user is set.
    // Email with create_user=false (linking a phone to an existing account): only USER.email exists.
    if (u.pathname === "/auth/v1/otp") {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      otpLog.push({ kind: "otp", phone: body.phone, email: body.email, create_user: body.create_user, channel: body.channel });
      const exists = body.phone ? KNOWN_PHONES.has(String(body.phone).replace(/\D/g, "")) : (body.email ?? "").toLowerCase() === USER.email;
      if (body.create_user === false && !exists) return send(res, 422, { code: 422, error_code: "otp_disabled", msg: "Signups not allowed for otp" });
      return send(res, 200, {});
    }
    if (u.pathname === "/auth/v1/user" && req.method === "PUT") {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      otpLog.push({ kind: "update_user", phone: body.phone, email: body.email });
      if (body.phone && String(body.phone).replace(/\D/g, "") === TAKEN_PHONE) return send(res, 422, { code: 422, error_code: "phone_exists", msg: "A user with this phone number has already been registered" });
      return send(res, 200, { ...USER, new_phone: body.phone, new_email: body.email });
    }
    if (u.pathname === "/auth/v1/verify") {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      if (body.token !== "123456") return send(res, 403, { code: "otp_expired", error_code: "otp_expired", msg: "Token has expired or is invalid" });
      otpLog.push({ kind: "verify", type: body.type, phone: body.phone, email: body.email });
      const b64u = (x) => Buffer.from(x).toString("base64url");
      const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: USER.id, exp: 4102444800, role: "authenticated", aud: "authenticated", email: body.email }))}.sig`;
      return send(res, 200, { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365, expires_at: 4102444800, user: { ...USER, email: body.email ?? USER.email, ...(body.phone ? { phone: String(body.phone).replace(/\D/g, ""), phone_confirmed_at: new Date().toISOString() } : {}) } });
    }
    if (u.pathname === "/auth/v1/invite") { try { inviteLog.push({ ...JSON.parse(raw || "{}"), redirect_to: u.searchParams.get("redirect_to") }); } catch { /* ignore */ } return send(res, 200, { id: crypto.randomUUID(), email: inviteLog.at(-1)?.email }); }
    if (u.pathname === "/__invites") return send(res, 200, inviteLog);
    if (u.pathname.startsWith("/auth/v1/")) return send(res, 200, {});
    if (u.pathname.startsWith("/storage/v1/")) return send(res, 400, { error: "not available in mock" });
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)/);
    if (rpc && compPool && COMP_RPC.test(rpc[1])) { let args = {}; try { args = JSON.parse(raw || "{}"); } catch { /* ignore */ } return void compRpc(rpc[1], args, res); }
    if (rpc) return send(res, 200, rpcs[rpc[1]] ?? null);
    const t = u.pathname.match(/^\/rest\/v1\/(\w+)/);
    if (!t) return send(res, 404, { message: "unknown" });
    const matches = (r) => [...u.searchParams].every(([k, v]) => !v.startsWith("eq.") || r[k] === undefined || String(r[k]) === v.slice(3));
    // Library tables keep writes in memory so saved items can be created, edited and deleted in browser walks.
    const LIVE = new Set(["saved_items", "assemblies", "assembly_items"]);
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (!LIVE.has(t[1])) return send(res, 201, []);
      const list = (tables[t[1]] ??= []);
      let body = null; try { body = JSON.parse(raw || "null"); } catch { /* ignore */ }
      if (req.method === "POST") {
        const add = (Array.isArray(body) ? body : [body]).filter(Boolean).map((r) => ({ id: r.id ?? crypto.randomUUID(), created_at: iso(0), ...r }));
        if (t[1] === "saved_items" && !rpcs.library_access) return send(res, 403, { code: "42501", message: 'new row violates row-level security policy for table "saved_items"' });
        list.push(...add);
        return send(res, 201, add);
      }
      if (req.method === "PATCH") {
        const hit = rpcs.library_access ? list.filter(matches) : [];
        for (const r of hit) Object.assign(r, body);
        return send(res, 200, hit);
      }
      if (req.method === "DELETE") {
        const keep = list.filter((r) => !matches(r));
        const gone = list.length - keep.length;
        tables[t[1]] = keep;
        if (t[1] === "assemblies") tables.assembly_items = (tables.assembly_items ?? []).filter((i) => keep.some((a) => a.id === i.assembly_id));
        return send(res, 200, gone ? [] : []);
      }
      return send(res, 201, []);
    }
    let rows = (tables[t[1]] ?? []).filter(matches);
    const one = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    if (one) return rows.length ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" });
    send(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
  });
}).listen(PORT, () => console.log(`mock supabase on ${PORT}`));
