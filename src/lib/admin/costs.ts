/**
 * Tech Stack & Costs: provider inventory, cost normalization, budgets and invoice import.
 * Pure functions (no I/O). The page loads admin_services / admin_expenses after requireAdmin().
 *
 * Rules that keep the numbers honest:
 *  - An unknown amount stays unknown (null). It is never summed as zero; totals list what is missing.
 *  - A yearly charge is shown as cash in the month it is paid and, separately, as a monthly equivalent.
 *  - Shared tools are counted at the owner's Built2Bid allocation %, never automatically at 100%.
 *  - Advertising spend lives only in marketing_costs (Marketing page), so it is never counted twice.
 *  - (service, invoice id) is unique in admin_expenses; import also skips exact repeats without an id.
 */

export const CATEGORIES = {
  hosting: "Hosting", database: "Database & storage", domains: "Domains", email: "Email", payments: "Payments",
  ai: "AI / API services", automation: "Automation", marketing: "Marketing tools", prospecting: "Prospecting",
  devtools: "Development software", monitoring: "Monitoring", other: "Other operating",
} as const;
export type Category = keyof typeof CATEGORIES;

export const STATUSES = {
  active: "Confirmed active", connected_unused: "Connected, not used", development: "Development only",
  proposed: "Proposed", discontinued: "Discontinued", unknown: "Unknown",
} as const;
export type ServiceStatus = keyof typeof STATUSES;

export const SOURCES = {
  verified: "Verified actual", provider_api: "Provider API", invoice: "Imported invoice", manual: "Manual entry", estimated: "Estimated", unknown: "Unknown",
} as const;
export type CostSource = keyof typeof SOURCES;

export const INTERVALS = { monthly: "Monthly", annual: "Annual", usage: "Usage-based", one_time: "One-time", none: "No charge" } as const;
export type Interval = keyof typeof INTERVALS;
export const COST_TYPES = { fixed: "Fixed", variable: "Variable", marketing: "Marketing", other: "Other" } as const;
export type CostType = keyof typeof COST_TYPES;

/** Acquisition-related categories (count toward CAC). Advertising itself comes from marketing_costs. */
export const ACQUISITION: Category[] = ["marketing", "prospecting"];
/** Cost of delivering the product (for gross margin). */
export const COGS: Category[] = ["hosting", "database", "email", "ai", "monitoring"];

export interface ServiceRow {
  provider_key: string; name: string; purpose: string | null; category: Category; status: ServiceStatus; plan: string | null;
  cost_type: CostType; amount_cents: number | null; billing_interval: Interval; next_renewal: string | null; allocation_pct: number;
  budget_monthly_cents: number | null; cost_source: CostSource; dashboard_url: string | null; invoice_ref: string | null; notes: string | null; updated_at: string | null;
}
export interface ExpenseRow { id: number; service_key: string; incurred_on: string; amount_cents: number; kind: CostType; source: "manual" | "invoice" | "provider_api"; external_id: string | null; note: string | null; created_at: string }

/**
 * Providers found while auditing the codebase and configuration (2026-11-15). `evidence` says what
 * was actually found; `detect` names the server environment variables whose presence confirms the
 * integration is configured on this deploy (values are never read into the page). Dashboard links
 * are generic provider URLs or ones verified from the provider's own API, never guessed account paths.
 */
export interface CatalogEntry {
  key: string; name: string; purpose: string; category: Category; defaultStatus: ServiceStatus; evidence: string;
  detect?: string[]; dashboard: string; plan?: string; billing: Interval; costNote: string;
}

export const CATALOG: CatalogEntry[] = [
  { key: "netlify", name: "Netlify", purpose: "Hosting, builds, serverless functions, DNS for built2bid.org", category: "hosting", defaultStatus: "active", evidence: "Production deploys from main; Netlify API reports plan id nf_team_dev", dashboard: "https://app.netlify.com/projects/built2bid", plan: "nf_team_dev (verify name in Netlify billing)", billing: "monthly", costNote: "Enter the plan price from Netlify → Team → Billing. Usage beyond the plan is billed separately." },
  { key: "supabase", name: "Supabase", purpose: "Postgres database, auth, file storage", category: "database", defaultStatus: "active", evidence: "Project asiiqmegvajtuspeumio; organization on the Pro plan", detect: ["NEXT_PUBLIC_SUPABASE_URL"], dashboard: "https://supabase.com/dashboard/project/asiiqmegvajtuspeumio", plan: "Pro", billing: "monthly", costNote: "Pro list price is $25/month including $10 compute credit; confirm on the Supabase invoice." },
  { key: "stripe", name: "Stripe", purpose: "Subscription billing and checkout", category: "payments", defaultStatus: "active", evidence: "Live mode keys in Production; webhook at /api/stripe/webhook", detect: ["STRIPE_SECRET_KEY"], dashboard: "https://dashboard.stripe.com/", plan: "Standard pricing", billing: "usage", costNote: "Processing fees are read from Stripe balance transactions on the Business Scorecard." },
  { key: "github", name: "GitHub", purpose: "Source code, pull requests, scheduled article workflow", category: "devtools", defaultStatus: "active", evidence: "Repository jwstein2/Bid2Build; GitHub Actions run the pricing-guide job", dashboard: "https://github.com/settings/billing", billing: "monthly", costNote: "Free for a personal public repository unless a paid plan is on the account." },
  { key: "google-workspace", name: "Google Workspace", purpose: "Company email (support@, james@ …)", category: "email", defaultStatus: "active", evidence: "One user with aliases on built2bid.org (configured 2026-11-12)", dashboard: "https://admin.google.com/ac/billing", billing: "monthly", costNote: "Per-user price depends on the Workspace edition. May be shared with other ventures: set the allocation." },
  { key: "domain", name: "built2bid.org domain", purpose: "Domain registration (purchased via Netlify)", category: "domains", defaultStatus: "active", evidence: "Purchased 2026-11-12 through Netlify", dashboard: "https://app.netlify.com/", billing: "annual", costNote: "Yearly renewal; enter the renewal price and date." },
  { key: "resend", name: "Resend", purpose: "Founder welcome emails (transactional)", category: "email", defaultStatus: "active", evidence: "Domain verified; FOUNDER_EMAIL_ENABLED in Production", detect: ["RESEND_API_KEY"], dashboard: "https://resend.com/", billing: "monthly", costNote: "Free tier covers 3,000 emails/month; enter the plan if upgraded." },
  { key: "supabase-smtp", name: "Sign-in email delivery (Supabase SMTP)", purpose: "6-digit sign-in codes", category: "email", defaultStatus: "active", evidence: "Supabase Auth sends codes through its SMTP settings; the app cannot read that configuration", dashboard: "https://supabase.com/dashboard/project/asiiqmegvajtuspeumio", billing: "none", costNote: "Covered by whichever mailbox or provider is set in Supabase SMTP." },
  { key: "anthropic-api", name: "Anthropic API", purpose: "AI scope/exclusions text in the builder; twice-weekly pricing guides", category: "ai", defaultStatus: "active", evidence: "ai_generations log records model, tokens and cost per request; ANTHROPIC_API_KEY GitHub Actions secret", detect: ["ANTHROPIC_API_KEY"], dashboard: "https://console.anthropic.com/", billing: "usage", costNote: "API usage only. A Claude or Claude Code subscription is a separate developer cost." },
  { key: "sentry", name: "Sentry", purpose: "Error monitoring and alerts", category: "monitoring", defaultStatus: "active", evidence: "NEXT_PUBLIC_SENTRY_DSN set in Netlify", detect: ["NEXT_PUBLIC_SENTRY_DSN"], dashboard: "https://sentry.io/", billing: "monthly", costNote: "Developer plan is free; enter the plan if upgraded." },
  { key: "google-analytics", name: "Google Analytics 4", purpose: "Website traffic (public pages)", category: "marketing", defaultStatus: "active", evidence: "Measurement ID set in Production (PR #34)", detect: ["NEXT_PUBLIC_GA_MEASUREMENT_ID"], dashboard: "https://analytics.google.com/", plan: "Standard (free)", billing: "none", costNote: "No charge for standard GA4." },
  { key: "search-console", name: "Google Search Console", purpose: "Organic search performance", category: "marketing", defaultStatus: "active", evidence: "Domain property verified; sitemap submitted", dashboard: "https://search.google.com/search-console", plan: "Free", billing: "none", costNote: "No charge." },
  { key: "google-places", name: "Google Maps Places API", purpose: "Address autofill in the builder", category: "ai", defaultStatus: "connected_unused", evidence: "Shipped but off until NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set", detect: ["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"], dashboard: "https://console.cloud.google.com/billing", billing: "usage", costNote: "Billed per request by Google Cloud after the monthly free allowance." },
  { key: "twilio", name: "Twilio", purpose: "SMS sign-in (paused)", category: "email", defaultStatus: "development", evidence: "SMS sign-in built but flag off; Trust Hub profile not approved", dashboard: "https://console.twilio.com/", billing: "usage", costNote: "Per-message charges and any phone-number fee." },
  { key: "instantly", name: "Instantly", purpose: "Cold email outreach (sync into the Sales funnel)", category: "prospecting", defaultStatus: "unknown", evidence: "Webhook/sync code exists; active only if INSTANTLY_SYNC_ENABLED and a key are set", detect: ["INSTANTLY_API_KEY"], dashboard: "https://app.instantly.ai/", billing: "monthly", costNote: "Enter the plan price and the Built2Bid share if used for other ventures." },
  { key: "apollo", name: "Apollo", purpose: "Prospect data", category: "prospecting", defaultStatus: "unknown", evidence: "No Built2Bid code or credentials found", dashboard: "https://app.apollo.io/", billing: "monthly", costNote: "Only add a cost if the subscription is used for Built2Bid." },
  { key: "apify", name: "Apify", purpose: "Web scraping actors", category: "automation", defaultStatus: "unknown", evidence: "No Built2Bid code or credentials found", dashboard: "https://console.apify.com/", billing: "usage", costNote: "Only add a cost for Built2Bid runs." },
  { key: "google-ads", name: "Google Ads", purpose: "Paid search", category: "marketing", defaultStatus: "unknown", evidence: "No API connection; spend is entered on Marketing", dashboard: "https://ads.google.com/", billing: "usage", costNote: "Ad spend goes on Marketing → Marketing spend, not here." },
  { key: "meta-ads", name: "Meta Ads", purpose: "Paid social", category: "marketing", defaultStatus: "unknown", evidence: "No API connection; spend is entered on Marketing", dashboard: "https://business.facebook.com/", billing: "usage", costNote: "Ad spend goes on Marketing → Marketing spend, not here." },
];

export interface ServiceView extends Omit<CatalogEntry, "plan"> {
  row: ServiceRow | null; status: ServiceStatus; plan: string | null; detected: boolean | null;
  amountCents: number | null; interval: Interval; allocation: number; source: CostSource; costType: CostType;
  /** Normalized monthly equivalent (total and Built2Bid share). null = unknown. */
  monthlyTotalCents: number | null; monthlyAllocatedCents: number | null;
  /** Dated charges this calendar month (allocated). */
  monthToDateCents: number; renewal: string | null; budgetCents: number | null; projectedCents: number | null; overBudget: boolean;
}

/** Monthly equivalent of a recurring charge. Usage-based charges come from the expense ledger instead. */
export function monthlyEquivalent(amount: number | null, interval: Interval): number | null {
  if (interval === "none") return 0;
  if (amount == null) return null;
  if (interval === "monthly") return amount;
  if (interval === "annual") return Math.round(amount / 12);
  return null; // usage / one_time: no recurring equivalent
}
export const allocate = (cents: number, pct: number) => Math.round((cents * pct) / 100);

const monthStart = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
const daysInMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();

/**
 * Merge the audited catalog with the owner's records. Custom services (not in the catalog) are
 * included as entered. `envPresent` says which detection variables exist on this deploy.
 */
export function serviceViews(rows: ServiceRow[], expenses: ExpenseRow[], envPresent: (name: string) => boolean, now: Date): ServiceView[] {
  const byKey = new Map(rows.map((r) => [r.provider_key, r]));
  const custom: CatalogEntry[] = rows.filter((r) => !CATALOG.some((c) => c.key === r.provider_key)).map((r) => ({
    key: r.provider_key, name: r.name, purpose: r.purpose ?? "", category: r.category, defaultStatus: r.status, evidence: "Added by the owner",
    dashboard: r.dashboard_url ?? "", billing: r.billing_interval, costNote: "",
  }));
  const ms = monthStart(now); const dim = daysInMonth(now); const dayOfMonth = now.getUTCDate();
  return [...CATALOG, ...custom].map((c) => {
    const row = byKey.get(c.key) ?? null;
    const interval = row?.billing_interval ?? c.billing;
    const amount = row ? row.amount_cents : interval === "none" ? 0 : null;
    const allocation = row?.allocation_pct ?? 100;
    const monthlyTotal = monthlyEquivalent(amount, interval);
    const mtd = expenses.filter((e) => e.service_key === c.key && Date.parse(`${e.incurred_on}T00:00:00Z`) >= ms).reduce((n, e) => n + e.amount_cents, 0);
    const mtdAllocated = allocate(mtd, allocation);
    const fixedPart = monthlyTotal != null && interval !== "usage" ? allocate(monthlyTotal, allocation) : 0;
    // Projection: recurring part as-is, usage part extrapolated from month-to-date dated charges.
    const usagePart = interval === "usage" ? Math.round((mtdAllocated / Math.max(1, dayOfMonth)) * dim) : 0;
    const projected = monthlyTotal == null && interval !== "usage" ? null : fixedPart + usagePart;
    const budget = row?.budget_monthly_cents ?? null;
    const detected = c.detect ? c.detect.some(envPresent) : null;
    return {
      ...c, row, status: row?.status ?? c.defaultStatus, plan: row?.plan ?? c.plan ?? null, detected,
      amountCents: amount, interval, allocation, source: row?.cost_source ?? (interval === "none" ? "estimated" : "unknown"), costType: row?.cost_type ?? (c.category === "marketing" || c.category === "prospecting" ? "marketing" : interval === "usage" ? "variable" : "fixed"),
      monthlyTotalCents: monthlyTotal, monthlyAllocatedCents: monthlyTotal == null ? null : allocate(monthlyTotal, allocation),
      monthToDateCents: mtdAllocated, renewal: row?.next_renewal ?? null, budgetCents: budget, projectedCents: projected,
      overBudget: budget != null && projected != null && projected > budget,
    };
  });
}

export interface CostTotals {
  /** Normalized monthly equivalent of known recurring costs (Built2Bid share), by cost type. */
  fixedMonthlyCents: number; variableMonthToDateCents: number; marketingToolsMonthlyCents: number; otherMonthlyCents: number;
  totalMonthlyKnownCents: number;
  /** Cash actually recorded this month (dated charges, allocated). */
  cashThisMonthCents: number;
  /** Active services whose cost is unknown: totals are incomplete while this is non-empty. */
  missing: ServiceView[];
}

export function costTotals(views: ServiceView[], expenses: ExpenseRow[], now: Date): CostTotals {
  const active = views.filter((v) => v.status === "active");
  const sum = (xs: ServiceView[], f: (v: ServiceView) => number | null) => xs.reduce((n, v) => n + (f(v) ?? 0), 0);
  const ms = monthStart(now);
  const alloc = new Map(views.map((v) => [v.key, v.allocation]));
  const cash = expenses.filter((e) => Date.parse(`${e.incurred_on}T00:00:00Z`) >= ms).reduce((n, e) => n + allocate(e.amount_cents, alloc.get(e.service_key) ?? 100), 0);
  const fixed = sum(active.filter((v) => v.costType === "fixed" && v.interval !== "usage"), (v) => v.monthlyAllocatedCents);
  const mkt = sum(active.filter((v) => v.costType === "marketing" && v.interval !== "usage"), (v) => v.monthlyAllocatedCents);
  const other = sum(active.filter((v) => v.costType === "other" && v.interval !== "usage"), (v) => v.monthlyAllocatedCents);
  const variable = sum(active.filter((v) => v.interval === "usage" || v.costType === "variable"), (v) => v.monthToDateCents);
  return {
    fixedMonthlyCents: fixed, variableMonthToDateCents: variable, marketingToolsMonthlyCents: mkt, otherMonthlyCents: other,
    totalMonthlyKnownCents: fixed + mkt + other, cashThisMonthCents: cash,
    missing: active.filter((v) => v.monthlyTotalCents == null && v.interval !== "usage" && v.interval !== "none"),
  };
}

/** Allocated recurring + dated costs for a window, split by category (for profit and CAC). */
export function costsForWindow(views: ServiceView[], expenses: ExpenseRow[], start: number, end: number) {
  const days = (end - start) / 86_400_000;
  const byCat = new Map<Category, number>();
  const add = (c: Category, n: number) => byCat.set(c, (byCat.get(c) ?? 0) + n);
  const alloc = new Map(views.map((v) => [v.key, v]));
  for (const v of views) if (v.status === "active" && v.monthlyAllocatedCents != null && v.interval !== "usage") add(v.category, Math.round(v.monthlyAllocatedCents * (days / 30.4375)));
  // Dated charges for usage-based services (recurring ones are already covered by their monthly equivalent).
  for (const e of expenses) {
    const v = alloc.get(e.service_key); const at = Date.parse(`${e.incurred_on}T00:00:00Z`);
    if (at < start || at > end) continue;
    if (v && v.interval !== "usage" && v.monthlyTotalCents != null) continue;
    add(v?.category ?? "other", allocate(e.amount_cents, v?.allocation ?? 100));
  }
  return byCat;
}

/** Renewals in the next `days` days, soonest first. */
export function renewals(views: ServiceView[], now: Date, days = 90) {
  const end = now.getTime() + days * 86_400_000;
  return views.filter((v) => v.renewal && v.status !== "discontinued" && Date.parse(`${v.renewal}T00:00:00Z`) >= now.getTime() - 86_400_000 && Date.parse(`${v.renewal}T00:00:00Z`) <= end)
    .sort((a, b) => Date.parse(a.renewal!) - Date.parse(b.renewal!));
}

// ---------------------------------------------------------------------------------------------
// Invoice / billing CSV import
// ---------------------------------------------------------------------------------------------
export interface ImportRow { service_key: string; incurred_on: string; amount_cents: number; external_id: string | null; note: string | null }
export interface ImportResult { rows: ImportRow[]; errors: string[] }

function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse "date,provider,amount,invoice_id,note" (header optional). Amounts are dollars ("12.50",
 * "$1,200.00", "-5" for a credit). Rows repeated inside the paste are dropped. At most 500 rows.
 */
export function parseExpenseCsv(text: string, knownKeys: Set<string>): ImportResult {
  const rows: ImportRow[] = []; const errors: string[] = []; const seen = new Set<string>();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 501) return { rows: [], errors: ["Import at most 500 rows at a time."] };
  lines.forEach((line, i) => {
    const cols = splitCsvLine(line);
    if (i === 0 && /date/i.test(cols[0] ?? "") && /provider|service/i.test(cols[1] ?? "")) return;
    const [date, key, amount, ext, note] = cols;
    const n = i + 1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) { errors.push(`Line ${n}: date must be YYYY-MM-DD`); return; }
    const k = (key ?? "").toLowerCase();
    if (!knownKeys.has(k)) { errors.push(`Line ${n}: unknown provider "${(key ?? "").slice(0, 40)}" (add the service first)`); return; }
    const dollars = Number((amount ?? "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(dollars) || Math.abs(dollars) > 1_000_000) { errors.push(`Line ${n}: amount is not a number`); return; }
    const external = (ext ?? "").slice(0, 120) || null;
    const row: ImportRow = { service_key: k, incurred_on: date!, amount_cents: Math.round(dollars * 100), external_id: external, note: (note ?? "").slice(0, 300) || null };
    const sig = external ? `${k}|id|${external}` : `${k}|${date}|${row.amount_cents}`;
    if (seen.has(sig)) { errors.push(`Line ${n}: duplicate of an earlier line, skipped`); return; }
    seen.add(sig); rows.push(row);
  });
  return { rows, errors };
}

/** Drop rows already in the ledger: same (service, invoice id), or same service/date/amount when there is no id. */
export function dedupeAgainst(rows: ImportRow[], existing: Pick<ExpenseRow, "service_key" | "incurred_on" | "amount_cents" | "external_id">[]) {
  const ids = new Set(existing.filter((e) => e.external_id).map((e) => `${e.service_key}|${e.external_id}`));
  const plain = new Set(existing.map((e) => `${e.service_key}|${e.incurred_on}|${e.amount_cents}`));
  const fresh: ImportRow[] = []; let skipped = 0;
  for (const r of rows) {
    const dup = r.external_id ? ids.has(`${r.service_key}|${r.external_id}`) : plain.has(`${r.service_key}|${r.incurred_on}|${r.amount_cents}`);
    if (dup) skipped++; else fresh.push(r);
  }
  return { fresh, skipped };
}

export interface CostIssue { severity: "red" | "amber"; title: string; detail: string; href: string }

/** Cost alerts for Needs attention: only budgets you set, renewals you entered, and the app's own AI budget. */
export function costIssues(views: ServiceView[], now: Date, ai?: { monthCents: number; budgetCents: number | null }): CostIssue[] {
  const out: CostIssue[] = [];
  const over = views.filter((v) => v.overBudget);
  if (over.length) out.push({ severity: "amber", title: `${over.length} service${over.length === 1 ? "" : "s"} projected over budget`, detail: over.map((v) => `${v.name}: ${(v.projectedCents! / 100).toFixed(0)} vs ${(v.budgetCents! / 100).toFixed(0)} USD`).join(" · "), href: "/admin/costs#services" });
  const soon = renewals(views, now, 7);
  if (soon.length) out.push({ severity: "amber", title: `${soon.length} renewal${soon.length === 1 ? "" : "s"} within 7 days`, detail: soon.map((v) => v.name).join(", "), href: "/admin/costs#services" });
  if (ai?.budgetCents && ai.monthCents >= ai.budgetCents * 0.8) out.push({ severity: ai.monthCents >= ai.budgetCents ? "red" : "amber", title: `AI spend at ${Math.round((ai.monthCents / ai.budgetCents) * 100)}% of the monthly budget`, detail: `${(ai.monthCents / 100).toFixed(2)} of ${(ai.budgetCents / 100).toFixed(2)} USD this month. AI text falls back to rules at the ceiling.`, href: "/admin/costs#usage" });
  return out;
}
