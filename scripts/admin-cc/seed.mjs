// Synthetic, clearly fake platform data for screenshots of the owner command center (MOCK_COMMAND_CENTER=1).
// Deterministic (seeded), so screenshots are reproducible. Never used outside the local mock.
// Business names end in "(demo)" so a screenshot can never be mistaken for real customers; the
// classification logic ignores names, so these still count as "genuine" in the mock on purpose.
let s = 42;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NOW = Date.now();
const iso = (daysAgo) => new Date(NOW - daysAgo * 864e5).toISOString();
const uuid = (p, n) => `${p}-4000-8000-${String(n).padStart(12, "0")}`;

const STATES = [["TX", "Austin", "78701", 18], ["FL", "Tampa", "33602", 12], ["CA", "Fresno", "93721", 9], ["OH", "Columbus", "43215", 8], ["NC", "Raleigh", "27601", 7], ["GA", "Atlanta", "30303", 6], ["CO", "Denver", "80202", 5], ["AZ", "Phoenix", "85004", 5], ["PA", "Pittsburgh", "15222", 4], ["MI", "Detroit", "48226", 3], ["WA", "Spokane", "99201", 3], ["TN", "Nashville", "37203", 2], ["IL", "Chicago", "60601", 2], ["MN", "Duluth", "55802", 1]];
const weighted = STATES.flatMap((x) => Array(x[3]).fill(x));
const TRADES = ["roofing", "siding", "decks", "concrete", "painting", "pressure-washing", "kitchens", "bathrooms", "fencing", "hvac", "gutters"];
const NAMES = ["Summit Exteriors", "Lone Star Roofing", "Gulf Coast Decks", "Buckeye Concrete", "Tarheel Painting", "Peach State Siding", "Front Range Fence", "Desert Pro Wash", "Steel City Kitchens", "Motor City Baths", "Evergreen Gutters", "Music City HVAC"];
// First-touch patterns: [source, medium, campaign, referrer, clickId, device]
const TOUCH = [
  ["google", "cpc", "roofers-tx-search", "google.com", "gclid", "mobile"],
  ["google", "cpc", "contractor-estimating", "google.com", "gclid", "desktop"],
  [null, null, null, "google.com", null, "desktop"],
  [null, null, null, "bing.com", null, "desktop"],
  ["facebook", "paid_social", "fb-contractors-q4", "facebook.com", "fbclid", "mobile"],
  ["youtube", "video", "how-to-bid-a-roof", "youtube.com", null, "mobile"],
  ["instantly", "email", "outreach-nov-roofers", null, null, "desktop"],
  [null, null, null, "contractortalk.com", null, "desktop"],
  [null, null, null, "(none)", null, "mobile"],
  [null, null, null, null, null, null],
];

export function commandCenterSeed(adminId) {
  const slug = (n) => n.toLowerCase().replace(/[^a-z]+/g, "");
  const users = NAMES.map((n, i) => ({ id: uuid("aaaaaaaa-aaaa", i + 1), name: `${n} (demo)`, email: `owner@${slug(n)}-demo.com`, created: 2 + Math.floor(rnd() * 80), home: pick(weighted) }));
  for (let i = 0; i < 9; i++) users.push({ id: uuid("aaaaaaaa-aaaa", 100 + i), name: null, email: `contractor${i + 1}@mail-demo.com`, created: Math.floor(rnd() * 40), home: pick(weighted) });
  const testUsers = [
    { id: uuid("eeeeeeee-eeee", 1), email: "stripe-test-1@built2bid.test", created: 6 },
    { id: uuid("eeeeeeee-eeee", 2), email: "qa+walkthrough@built2bid.test", created: 3 },
    { id: uuid("eeeeeeee-eeee", 3), email: "sample.account@demo-mail.com", created: 8 },
  ];
  const estimates = [], versions = [], signatures = [], signing = [];
  let n = 0;
  for (const u of [...users, ...testUsers.map((t) => ({ ...t, name: null, home: pick(weighted) }))]) {
    const count = u.name ? 3 + Math.floor(rnd() * 12) : Math.floor(rnd() * 3);
    for (let k = 0; k < count; k++) {
      n++;
      const age = Math.floor(rnd() * Math.min(u.created + 1, 75));
      const st = rnd() < 0.7 ? u.home : pick(weighted);
      const mode = rnd();
      const id = uuid("bbbbbbbb-bbbb", n);
      estimates.push({
        id, user_id: u.id, company_id: null, trades: [pick(TRADES)], template_trade: null, status: "draft", created_at: iso(age),
        location_state: mode < 0.35 ? st[0] : null, location_zip: mode < 0.25 ? st[2] : null,
        project_address: mode < 0.8 ? `${100 + n} Demo St, ${st[1]}, ${st[0]} ${st[2]}` : "",
      });
      if (rnd() < 0.55) {
        versions.push({ estimate_id: id, user_id: u.id, created_at: iso(Math.max(0, age - 1)), version_number: 1 });
        if (rnd() < 0.3) versions.push({ estimate_id: id, user_id: u.id, created_at: iso(Math.max(0, age - 2)), version_number: 2 });
        if (age < 30 && rnd() < 0.5) {
          const signed = rnd() < 0.6;
          const reqId = uuid("dddddddd-dddd", n);
          signing.push({ id: reqId, estimate_id: id, user_id: u.id, company_id: null, status: signed ? "signed" : "pending", created_at: iso(Math.max(0, age - 1)), signed_at: signed ? iso(Math.max(0, age - 3)) : null, expires_at: iso(age - 31) });
          if (signed) signatures.push({ estimate_id: id, user_id: u.id, signed_at: iso(Math.max(0, age - 3)), pdf_status: n % 17 === 0 ? "failed" : "ready" });
        }
      }
    }
  }
  const named = users.filter((u) => u.name);
  const sub = (u, i, o) => ({ stripe_subscription_id: `sub_demo_${i}`, user_id: u.id, stripe_customer_id: `cus_demo_${i}`, status: "active", plan: "monthly", cancel_at_period_end: false, canceled_at: null, ended_at: null, updated_at: iso(i * 6 + 1), seat_quantity: null, current_period_end: iso(-20), company_id: null, ...o });
  const subscriptions = [
    sub(named[0], 0, { plan: "monthly", pm_addon: true }), sub(named[1], 1, { plan: "monthly", pm_addon: false, pm_addon_until: iso(-10) }), sub(named[2], 2, { plan: "monthly" }),
    sub(named[3], 3, { plan: "monthly", cancel_at_period_end: true, canceled_at: iso(4) }),
    sub(named[4], 4, { plan: "annual", pm_addon: true }), sub(named[5], 5, { plan: "annual", status: "past_due" }),
    sub(named[6], 6, { plan: "enterprise", seat_quantity: 6, company_id: uuid("cccccccc-cccc", 1), pm_extra_editors: 2 }),
    sub(named[7], 7, { status: "canceled", canceled_at: iso(12), ended_at: iso(12), updated_at: iso(12), current_period_end: iso(12) }),
    sub(testUsers[0], 8, { plan: "monthly" }),
  ];
  const startDays = [44, 30, 9, 52, 21, 70, 16, 60, 5];
  const events = [];
  subscriptions.forEach((x, i) => events.push({ event: "subscribed", user_id: x.user_id, created_at: iso(startDays[i]) }));
  for (let i = 0; i < 16; i++) events.push({ event: "checkout_started", user_id: pick(users).id, created_at: iso(Math.floor(rnd() * 80)) });
  const allAuth = [...users, ...testUsers];
  const leads = users.map((u, i) => {
    const t = TOUCH[i % TOUCH.length];
    return { id: uuid("ffffffff-ffff", i + 1), email_norm: u.email, user_id: u.id, stage: "signed_up", source: t[0] ?? (t[3] && t[3] !== "(none)" ? t[3] : "direct"), utm_source: t[0], utm_medium: t[1], utm_campaign: t[2], first_campaign_id: t[0] === "instantly" ? "outreach-nov-roofers" : null, first_campaign_name: null, landing_path: pick(["/", "/bids/roofing", "/bids/decks", "/pricing", "/learn/how-to-estimate-a-roof"]), first_touch_at: iso(u.created), referrer_host: t[3], click_id_type: t[4], device_type: t[5], created_at: iso(u.created) };
  });
  // V4 pipeline / scheduling adoption (Phase 10): stages by position (no extra rnd() calls, so the rest of the
  // seed stays identical), a few moves, schedules, published updates, editor seats and report generations.
  const STAGES = ["draft", "draft", "sent", "pending", "won", "draft", "scheduled", "lost", "in_progress", "completed"];
  estimates.forEach((e, i) => { e.pipeline_stage = STAGES[i % STAGES.length]; });
  const moved = estimates.filter((e) => e.pipeline_stage !== "draft");
  const estimate_stage_history = moved.slice(0, 24).map((e, i) => ({ estimate_id: e.id, changed_by: e.user_id, from_stage: "draft", to_stage: e.pipeline_stage, created_at: iso((i * 3) % 50) }));
  const project_schedules = moved.filter((e) => ["scheduled", "in_progress", "completed"].includes(e.pipeline_stage)).slice(0, 9).map((e, i) => ({ id: uuid("12121212-1212", i + 1), estimate_id: e.id, user_id: e.user_id, company_id: null, status: i === 8 ? "archived" : i % 3 === 0 ? "completed" : "active", created_at: iso((i * 5) % 45) }));
  const schedule_publications = project_schedules.slice(0, 6).flatMap((x, i) => [{ schedule_id: x.id, published_by: x.user_id, published_at: iso(i * 4) }, ...(i % 2 ? [{ schedule_id: x.id, published_by: x.user_id, published_at: iso(i * 4 + 20) }] : [])]);
  const pm_editors = [{ company_id: uuid("cccccccc-cccc", 1), user_id: named[6].id, assigned_at: iso(20) }];
  const report_generations = [named[0], named[0], named[2], named[4], named[6], named[0]].map((u, i) => ({ user_id: u.id, company_id: null, kind: "internal_estimate", action: ["preview", "download", "send"][i % 3], created_at: iso(i * 6) }));
  const month = new Date(NOW).toISOString().slice(0, 7);
  const prev = new Date(NOW - 31 * 864e5).toISOString().slice(0, 7);
  return {
    tables: {
      estimates, estimate_versions: versions, signatures, signing_requests: signing, subscriptions,
      estimate_stage_history, project_schedules, schedule_publications, pm_editors, report_generations,
      profiles: allAuth.map((u) => ({ id: u.id, created_at: iso(u.created) })),
      business_profiles: named.map((u) => ({ user_id: u.id, company_name: u.name, created_at: iso(u.created) })),
      companies: [{ id: uuid("cccccccc-cccc", 1), name: "Front Range Fence Group (demo)", created_at: iso(30), owner_user_id: named[6].id }],
      company_members: [{ company_id: uuid("cccccccc-cccc", 1), user_id: named[6].id, role: "owner", status: "active" }],
      complimentary_grants: [
        { id: uuid("99999999-9999", 1), email: named[8].email, user_id: named[8].id, status: "active", plan: "unlimited", starts_at: iso(25), expires_at: iso(-5), created_at: iso(25), company_id: null, granted_by: adminId, note: "Trade show follow-up", extra_seats: 0, invite_expires_at: null, revoked_at: null },
        { id: uuid("99999999-9999", 2), email: named[9].email, user_id: named[9].id, status: "active", plan: "enterprise", starts_at: iso(5), expires_at: iso(-85), created_at: iso(5), company_id: null, granted_by: adminId, note: "Pilot, 3 seats", extra_seats: 0, invite_expires_at: null, revoked_at: null },
        { id: uuid("99999999-9999", 3), email: "newprospect@roofing-demo.com", user_id: null, status: "pending", plan: "unlimited", starts_at: null, expires_at: null, created_at: iso(40), company_id: null, granted_by: adminId, note: null, extra_seats: 0, invite_expires_at: iso(10), revoked_at: null },
      ],
      market_consent: named.slice(0, 4).map((u) => ({ user_id: u.id, share_prices: true, updated_at: iso(3) })),
      analytics_events: events,
      leads,
      marketing_costs: [
        { id: 1, period_start: `${month}-01`, channel: "google_ads", campaign_id: "roofers-tx-search", amount_usd: "420.00", note: "Google Ads", created_at: iso(1) },
        { id: 2, period_start: `${prev}-01`, channel: "google_ads", campaign_id: "contractor-estimating", amount_usd: "310.00", note: null, created_at: iso(20) },
        { id: 3, period_start: `${month}-01`, channel: "meta_ads", campaign_id: "fb-contractors-q4", amount_usd: "180.00", note: null, created_at: iso(2) },
      ],
      email_outbox: [{ kind: "founder_welcome", user_id: named[1].id, status: "failed", last_error: "Resend 422: domain not verified (demo)", attempts: 5, created_at: iso(9), updated_at: iso(8) }],
      stripe_events: Array.from({ length: 6 }, (_, i) => ({ id: `evt_demo_${i}`, type: i % 2 ? "invoice.paid" : "customer.subscription.updated", received_at: iso(i * 0.7), processed_at: iso(i * 0.7), error: null })),
      admin_roles: adminId ? [{ user_id: adminId, role: "admin" }] : [],
      admin_account_labels: [{ user_id: testUsers[2].id, label: "demo", note: "Sales demo account", updated_at: iso(2) }],
      admin_services: [
        { provider_key: "netlify", name: "Netlify", purpose: null, category: "hosting", status: "active", plan: "Pro (demo)", cost_type: "fixed", amount_cents: 1900, billing_interval: "monthly", next_renewal: iso(-4).slice(0, 10), allocation_pct: 100, budget_monthly_cents: 5000, cost_source: "manual", dashboard_url: "https://app.netlify.com/", invoice_ref: null, notes: null, updated_at: iso(1) },
        { provider_key: "supabase", name: "Supabase", purpose: null, category: "database", status: "active", plan: "Pro", cost_type: "fixed", amount_cents: 2500, billing_interval: "monthly", next_renewal: iso(-12).slice(0, 10), allocation_pct: 100, budget_monthly_cents: null, cost_source: "invoice", dashboard_url: "https://supabase.com/dashboard", invoice_ref: "INV-demo-1", notes: null, updated_at: iso(1) },
        { provider_key: "domain", name: "built2bid.org domain", purpose: null, category: "domains", status: "active", plan: null, cost_type: "fixed", amount_cents: 1800, billing_interval: "annual", next_renewal: iso(-360).slice(0, 10), allocation_pct: 100, budget_monthly_cents: null, cost_source: "manual", dashboard_url: null, invoice_ref: null, notes: null, updated_at: iso(1) },
        { provider_key: "google-workspace", name: "Google Workspace", purpose: null, category: "email", status: "active", plan: "Business Starter", cost_type: "fixed", amount_cents: 840, billing_interval: "monthly", next_renewal: null, allocation_pct: 50, budget_monthly_cents: null, cost_source: "manual", dashboard_url: null, invoice_ref: null, notes: "Shared with another venture", updated_at: iso(1) },
        { provider_key: "anthropic-api", name: "Anthropic API", purpose: null, category: "ai", status: "active", plan: null, cost_type: "variable", amount_cents: null, billing_interval: "usage", next_renewal: null, allocation_pct: 100, budget_monthly_cents: 1000, cost_source: "provider_api", dashboard_url: null, invoice_ref: null, notes: null, updated_at: iso(1) },
      ],
      admin_expenses: [
        { id: 1, service_key: "netlify", incurred_on: iso(3).slice(0, 10), amount_cents: 1900, kind: "fixed", source: "invoice", external_id: "NF-1001", note: null, created_at: iso(3) },
        { id: 2, service_key: "supabase", incurred_on: iso(5).slice(0, 10), amount_cents: 2500, kind: "fixed", source: "invoice", external_id: "SB-2001", note: null, created_at: iso(5) },
      ],
      ai_generations: Array.from({ length: 14 }, (_, i) => ({ created_at: iso(i * 2), cost_usd: (0.008 + (i % 4) * 0.002).toFixed(6), status: i === 5 ? "failed" : "ok" })),
    },
    authUsers: allAuth.map((u, i) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, created_at: iso(u.created), email_confirmed_at: i % 7 === 3 ? null : iso(u.created), last_sign_in_at: iso(Math.max(0, u.created - 3)), app_metadata: {}, user_metadata: {} })),
    adminMetrics: {
      accounts: allAuth.length, verified_accounts: allAuth.length - 2, plans: { monthly: 4, annual: 2 }, exports_this_month: 0, exports_by_month: [], trade_popularity: [],
      funnel_30d: { landing_view: 1840, trade_selected: 612, builder_started: 401, account_created: 77, export_succeeded: 58, checkout_started: 14, subscribed: 6 },
      import_failures_7d: 1, pdf_errors_7d: 0, api_usage_30d: {},
    },
  };
}
