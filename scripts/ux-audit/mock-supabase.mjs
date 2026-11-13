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
  saved_items: [{ id: "66666666-6666-4666-8666-000000000001", user_id: USER.id, name: "Dumpster rental (20 yd)", cost_type: "equipment", unit: "each", unit_cost: 450, taxable: true, description: null, created_at: iso(5) }],
  assemblies: [], assembly_items: [],
  subscriptions: process.env.MOCK_UNLIMITED ? [{ id: "sub_test", user_id: USER.id, status: "active", plan: "monthly", price_id: "price_test", current_period_end: iso(-20), cancel_at_period_end: false, updated_at: iso(1) }] : [],
  billing_customers: [], profiles: [{ id: USER.id, marketing_opt_in: false, created_at: iso(30) }], market_consent: [],
  estimate_project_profiles: [], trade_templates: [], feature_flags: [], audit_logs: [], import_logs: [], pdf_errors: [],
};
const rpcs = {
  is_admin: process.env.MOCK_ADMIN === "1",
  credit_status: [{ starter_balance: 2, starter_total: 3, monthly_balance: 0, monthly_eligible: false, next_cycle_at: iso(-12), unlimited: Boolean(process.env.MOCK_UNLIMITED), email_verified: true, starter_granted: true }],
  save_estimate: { id: EST }, market_log_view: null,
};

// Account scenarios for the account-aware CTA checks (scripts/account-ctas/run.mjs). Switch at runtime with
// GET /__scenario?name=<key>&authDelayMs=<n>. MOCK_UNLIMITED keeps its old meaning for the UX audit scripts.
const sub = (o) => [{ stripe_subscription_id: "sub_test", id: "sub_test", user_id: USER.id, status: "active", plan: "monthly", price_id: "price_test", current_period_end: iso(-20), cancel_at_period_end: false, canceled_at: null, ended_at: null, updated_at: iso(1), ...o }];
const credit = (o) => [{ starter_balance: 2, starter_total: 3, monthly_balance: 0, monthly_eligible: false, next_cycle_at: iso(-12), unlimited: false, email_verified: true, starter_granted: true, ...o }];
export const SCENARIOS = {
  starter: { credit: credit({}), subs: [] },
  monthly: { credit: credit({ starter_balance: 0, monthly_balance: 1, monthly_eligible: true }), subs: [] },
  unlimited: { credit: credit({ unlimited: true }), subs: sub({}) },
  canceling: { credit: credit({ unlimited: true }), subs: sub({ cancel_at_period_end: true, canceled_at: iso(2) }) },
  expired: { credit: credit({ starter_balance: 0, monthly_balance: 0, monthly_eligible: true }), subs: sub({ status: "canceled", current_period_end: iso(3), ended_at: iso(3), canceled_at: iso(30) }) },
  zero: { credit: credit({ starter_balance: 0, monthly_balance: 0, monthly_eligible: true }), subs: [] },
};
let authDelayMs = 0;
function applyScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) return false;
  rpcs.credit_status = sc.credit;
  tables.subscriptions = sc.subs;
  return true;
}
if (process.env.MOCK_SCENARIO) applyScenario(process.env.MOCK_SCENARIO);

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "content-range" };
const send = (res, code, body, extra = {}) => { res.writeHead(code, { "content-type": "application/json", ...cors, ...extra }); res.end(body === undefined ? "" : JSON.stringify(body)); };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.method === "OPTIONS") return send(res, 204);
    if (u.pathname === "/__scenario") {
      authDelayMs = Number(u.searchParams.get("authDelayMs") ?? 0);
      return applyScenario(u.searchParams.get("name") ?? "") ? send(res, 200, { ok: true }) : send(res, 400, { error: "unknown scenario" });
    }
    if (u.pathname === "/auth/v1/user") return void setTimeout(() => send(res, 200, USER), authDelayMs);
    // Email OTP for checkout-flow tests: any address, code 123456 succeeds, anything else is "expired or invalid".
    if (u.pathname === "/auth/v1/otp") return send(res, 200, {});
    if (u.pathname === "/auth/v1/verify") {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      if (body.token !== "123456") return send(res, 403, { code: "otp_expired", error_code: "otp_expired", msg: "Token has expired or is invalid" });
      const b64u = (x) => Buffer.from(x).toString("base64url");
      const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: USER.id, exp: 4102444800, role: "authenticated", aud: "authenticated", email: body.email }))}.sig`;
      return send(res, 200, { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365, expires_at: 4102444800, user: { ...USER, email: body.email ?? USER.email } });
    }
    if (u.pathname.startsWith("/auth/v1/")) return send(res, 200, {});
    if (u.pathname.startsWith("/storage/v1/")) return send(res, 400, { error: "not available in mock" });
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)/);
    if (rpc) return send(res, 200, rpcs[rpc[1]] ?? null);
    const t = u.pathname.match(/^\/rest\/v1\/(\w+)/);
    if (!t) return send(res, 404, { message: "unknown" });
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 201, []);
    let rows = tables[t[1]] ?? [];
    for (const [k, v] of u.searchParams) if (v.startsWith("eq.")) rows = rows.filter((r) => r[k] === undefined || String(r[k]) === v.slice(3));
    const one = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    if (one) return rows.length ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" });
    send(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
  });
}).listen(PORT, () => console.log(`mock supabase on ${PORT}`));
