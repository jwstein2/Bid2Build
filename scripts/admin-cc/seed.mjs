// Synthetic, clearly fake platform data for screenshots of the admin command center (MOCK_COMMAND_CENTER=1).
// Deterministic (seeded), so screenshots are reproducible. Never used outside the local mock.
let s = 42;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NOW = Date.now();
const iso = (daysAgo) => new Date(NOW - daysAgo * 864e5).toISOString();
const uuid = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const STATES = [["TX", "Austin", "78701", 18], ["FL", "Tampa", "33602", 12], ["CA", "Fresno", "93721", 9], ["OH", "Columbus", "43215", 8], ["NC", "Raleigh", "27601", 7], ["GA", "Atlanta", "30303", 6], ["CO", "Denver", "80202", 5], ["AZ", "Phoenix", "85004", 5], ["PA", "Pittsburgh", "15222", 4], ["MI", "Detroit", "48226", 3], ["WA", "Spokane", "99201", 3], ["TN", "Nashville", "37203", 2], ["IL", "Chicago", "60601", 2], ["MN", "Duluth", "55802", 1]];
const weighted = STATES.flatMap((x) => Array(x[3]).fill(x));
const TRADES = ["roofing", "siding", "decks", "concrete", "painting", "pressure-washing", "kitchens", "bathrooms", "fencing", "hvac", "gutters"];
const NAMES = ["Summit Exteriors", "Lone Star Roofing", "Gulf Coast Decks", "Buckeye Concrete", "Tarheel Painting", "Peach State Siding", "Front Range Fence", "Desert Pro Wash", "Steel City Kitchens", "Motor City Baths", "Evergreen Gutters", "Music City HVAC"];

export function commandCenterSeed() {
  const users = NAMES.map((n, i) => ({ id: uuid("aaaaaaaa-aaaa", i + 1), name: `${n} (demo)`, created: 2 + Math.floor(rnd() * 80), home: pick(weighted) }));
  for (let i = 0; i < 9; i++) users.push({ id: uuid("aaaaaaaa-aaaa", 100 + i), name: null, created: Math.floor(rnd() * 40), home: pick(weighted) });
  const estimates = [], versions = [], signatures = [];
  let n = 0;
  for (const u of users) {
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
        if (rnd() < 0.35) signatures.push({ estimate_id: id, user_id: u.id, signed_at: iso(Math.max(0, age - 3)) });
      }
    }
  }
  const named = users.filter((u) => u.name);
  const subscriptions = named.slice(0, 6).map((u, i) => ({ stripe_subscription_id: `sub_demo_${i}`, user_id: u.id, status: i === 5 ? "past_due" : "active", plan: i < 4 ? "monthly" : "annual", cancel_at_period_end: i === 3, canceled_at: i === 3 ? iso(4) : null, ended_at: null, updated_at: iso(i * 6 + 1), seat_quantity: null, current_period_end: iso(-20) }));
  subscriptions.push({ stripe_subscription_id: "sub_demo_old", user_id: named[7].id, status: "canceled", plan: "monthly", cancel_at_period_end: false, canceled_at: iso(12), ended_at: iso(12), updated_at: iso(12), seat_quantity: null, current_period_end: iso(12) });
  const events = [];
  for (let i = 0; i < 14; i++) events.push({ event: "checkout_started", created_at: iso(Math.floor(rnd() * 80)) });
  for (const sub of subscriptions) events.push({ event: "subscribed", created_at: sub.updated_at });
  return {
    tables: {
      estimates, estimate_versions: versions, signatures, subscriptions,
      profiles: users.map((u) => ({ id: u.id, created_at: iso(u.created) })),
      business_profiles: named.map((u) => ({ user_id: u.id, company_name: u.name, created_at: iso(u.created) })),
      companies: [{ id: uuid("cccccccc-cccc", 1), name: "Summit Exteriors Group (demo)", created_at: iso(9) }],
      complimentary_grants: [{ user_id: named[8].id, status: "active", plan: "unlimited", starts_at: iso(10), expires_at: iso(-300) }, { user_id: named[9].id, status: "active", plan: "enterprise", starts_at: iso(5), expires_at: iso(-360) }],
      market_consent: named.slice(0, 4).map((u) => ({ user_id: u.id, share_prices: true, updated_at: iso(3) })),
      analytics_events: events,
    },
    adminMetrics: {
      accounts: users.length, verified_accounts: users.length - 2, plans: { monthly: 4, annual: 2 }, exports_this_month: 0, exports_by_month: [], trade_popularity: [],
      funnel_30d: { landing_view: 1840, trade_selected: 612, builder_started: 401, account_created: 77, export_succeeded: 58, checkout_started: 14, subscribed: 6 },
      import_failures_7d: 1, pdf_errors_7d: 0, api_usage_30d: {},
    },
  };
}
