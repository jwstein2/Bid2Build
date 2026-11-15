/**
 * Capacity and cost forecast for N paying businesses. Pure and client-safe (no secrets, no I/O).
 *
 * Inputs come in two kinds and the page labels them separately:
 *  - Observed: measured from Built2Bid today (database size, file sizes, AI cost per request …).
 *  - Assumptions: editable guesses about future behavior and provider list prices. Prices are public
 *    list prices as understood on 2026-11-15 and must be checked against the provider before relying
 *    on them. Costs are modeled per provider tier, not as a straight line.
 */

export interface Observed {
  dbBytes: number | null; storageBytes: number | null; estimates: number; businesses: number;
  aiCostPerGenerationUsd: number | null; arpaUsd: number | null; hostingMonthlyUsd: number | null;
}

export interface Assumptions {
  freePerPaying: number; estimatesPerBusinessMonth: number; pdfsPerEstimate: number; avgPdfKb: number;
  signedPerBusinessMonth: number; dbKbPerEstimate: number; aiGenerationsPerBusinessMonth: number; aiCostPerGenerationUsd: number;
  emailsPerBusinessMonth: number; requestsPerBusinessMonth: number; retentionMonths: number; arpaUsd: number;
  hostingBaseUsd: number; hostingPerMillionRequestsUsd: number;
}

/** Provider list prices used by the model (editable on the page). */
export const PRICES = {
  supabase: { baseUsd: 25, dbGbIncluded: 8, storageGbIncluded: 100, egressGbIncluded: 250, mauIncluded: 100_000, dbGbUsd: 0.125, storageGbUsd: 0.021, egressGbUsd: 0.09, mauUsd: 0.00325 },
  /** Net compute add-on after the Pro plan's $10 credit, by paying-business threshold (assumption). */
  compute: [{ upTo: 1_000, name: "Micro", usd: 0 }, { upTo: 2_500, name: "Small", usd: 5 }, { upTo: 6_000, name: "Medium", usd: 50 }, { upTo: Infinity, name: "Large", usd: 100 }],
  email: [{ upTo: 3_000, name: "Resend Free", usd: 0 }, { upTo: 50_000, name: "Resend Pro", usd: 20 }, { upTo: 100_000, name: "Resend Scale", usd: 90 }, { upTo: Infinity, name: "Resend Scale + overage", usd: 90, perThousandOver100k: 0.9 }],
  workspaceSmtpDailyLimit: 2_000,
  stripe: { pct: 0.029, fixedUsd: 0.3, billingPct: 0.007 },
  sentry: { freeErrors: 5_000, teamUsd: 26, errorsPerBusinessMonth: 1 },
} as const;

export function defaultAssumptions(o: Observed): Assumptions {
  const perEstimateKb = o.dbBytes && o.estimates >= 50 ? Math.max(5, Math.round(o.dbBytes / 1024 / o.estimates / 4)) : 40;
  return {
    freePerPaying: 4, estimatesPerBusinessMonth: 12, pdfsPerEstimate: 1.5, avgPdfKb: 250, signedPerBusinessMonth: 2,
    dbKbPerEstimate: perEstimateKb, aiGenerationsPerBusinessMonth: 4,
    aiCostPerGenerationUsd: o.aiCostPerGenerationUsd != null ? Math.round(o.aiCostPerGenerationUsd * 10000) / 10000 : 0.01,
    emailsPerBusinessMonth: 6, requestsPerBusinessMonth: 1_500, retentionMonths: 24,
    arpaUsd: o.arpaUsd ?? 19.99, hostingBaseUsd: o.hostingMonthlyUsd ?? 19, hostingPerMillionRequestsUsd: 2,
  };
}

export interface ForecastLine { key: string; label: string; usd: number; note: string }
export interface ForecastResult {
  paying: number; accounts: number; lines: ForecastLine[]; totalUsd: number; perCustomerUsd: number;
  revenueUsd: number; contributionUsd: number; marginPct: number | null; limits: string[];
}

const tier = <T extends { upTo: number }>(tiers: readonly T[], v: number) => tiers.find((t) => v <= t.upTo) ?? tiers[tiers.length - 1];
const r2 = (n: number) => Math.round(n * 100) / 100;

export function forecast(paying: number, a: Assumptions, o: Observed): ForecastResult {
  const n = Math.max(0, Math.round(paying));
  const accounts = Math.round(n * (1 + a.freePerPaying));
  // Free accounts use the product far less; model them at 20% of a paying business's activity.
  const activeUnits = n + accounts * 0.2 - n * 0.2;
  const estimates = activeUnits * a.estimatesPerBusinessMonth;
  const s = PRICES.supabase;
  const baselineDbGb = (o.dbBytes ?? 50 * 1024 ** 2) / 1024 ** 3;
  const dbGb = baselineDbGb + (estimates * a.retentionMonths * a.dbKbPerEstimate) / 1024 ** 2;
  const pdfGbMonth = (estimates * a.pdfsPerEstimate * a.avgPdfKb + activeUnits * a.signedPerBusinessMonth * a.avgPdfKb) / 1024 ** 2;
  const storageGb = (o.storageBytes ?? 0) / 1024 ** 3 + pdfGbMonth * a.retentionMonths;
  const egressGb = pdfGbMonth * 2 + activeUnits * 0.05;
  const compute = tier(PRICES.compute, n);
  const supabase = s.baseUsd + compute.usd + Math.max(0, dbGb - s.dbGbIncluded) * s.dbGbUsd + Math.max(0, storageGb - s.storageGbIncluded) * s.storageGbUsd
    + Math.max(0, egressGb - s.egressGbIncluded) * s.egressGbUsd + Math.max(0, accounts - s.mauIncluded) * s.mauUsd;
  const requests = activeUnits * a.requestsPerBusinessMonth;
  const hosting = a.hostingBaseUsd + (requests / 1_000_000) * a.hostingPerMillionRequestsUsd;
  const emails = activeUnits * a.emailsPerBusinessMonth;
  const et = tier(PRICES.email, emails);
  const email = et.usd + ("perThousandOver100k" in et ? Math.max(0, emails - 100_000) / 1000 * et.perThousandOver100k : 0);
  const ai = activeUnits * a.aiGenerationsPerBusinessMonth * a.aiCostPerGenerationUsd;
  const errors = activeUnits * PRICES.sentry.errorsPerBusinessMonth;
  const monitoring = errors > PRICES.sentry.freeErrors ? PRICES.sentry.teamUsd : 0;
  const revenue = n * a.arpaUsd;
  const stripe = n * (a.arpaUsd * (PRICES.stripe.pct + PRICES.stripe.billingPct) + PRICES.stripe.fixedUsd);
  const lines: ForecastLine[] = [
    { key: "hosting", label: "Hosting (Netlify)", usd: r2(hosting), note: `${Math.round(requests).toLocaleString("en-US")} requests/month` },
    { key: "supabase", label: "Supabase (database, storage, transfer)", usd: r2(supabase), note: `${dbGb.toFixed(1)} GB DB · ${storageGb.toFixed(1)} GB files · ${egressGb.toFixed(0)} GB egress · ${compute.name} compute` },
    { key: "email", label: "Transactional email", usd: r2(email), note: `${Math.round(emails).toLocaleString("en-US")} emails/month · ${et.name}` },
    { key: "ai", label: "AI text generation", usd: r2(ai), note: `${Math.round(activeUnits * a.aiGenerationsPerBusinessMonth).toLocaleString("en-US")} requests` },
    { key: "monitoring", label: "Error monitoring", usd: r2(monitoring), note: monitoring ? "Above the free error allowance" : "Within the free allowance" },
    { key: "stripe", label: "Stripe fees", usd: r2(stripe), note: "2.9% + 30¢ per payment, plus 0.7% Billing" },
  ];
  const total = lines.reduce((x, l) => x + l.usd, 0);
  const limits: string[] = [];
  if (dbGb > s.dbGbIncluded) limits.push(`Database passes the ${s.dbGbIncluded} GB included in Supabase Pro (${dbGb.toFixed(1)} GB).`);
  if (storageGb > s.storageGbIncluded) limits.push(`File storage passes ${s.storageGbIncluded} GB (${storageGb.toFixed(0)} GB).`);
  if (egressGb > s.egressGbIncluded) limits.push(`Transfer passes ${s.egressGbIncluded} GB/month (${egressGb.toFixed(0)} GB).`);
  if (compute.usd > 0) limits.push(`Supabase compute likely needs the ${compute.name} tier.`);
  if (emails > 3_000) limits.push(`Email volume (${Math.round(emails).toLocaleString("en-US")}/month) exceeds the Resend free tier.`);
  const dailySignIns = (activeUnits * 4) / 30;
  if (dailySignIns > PRICES.workspaceSmtpDailyLimit * 0.5) limits.push(`Sign-in emails (~${Math.round(dailySignIns).toLocaleString("en-US")}/day) approach the ~${PRICES.workspaceSmtpDailyLimit.toLocaleString("en-US")}/day limit of a single mailbox SMTP; move Supabase SMTP to a transactional provider.`);
  if (accounts > s.mauIncluded) limits.push(`Monthly active users pass ${s.mauIncluded.toLocaleString("en-US")}.`);
  return {
    paying: n, accounts, lines, totalUsd: r2(total), perCustomerUsd: n ? r2(total / n) : 0,
    revenueUsd: r2(revenue), contributionUsd: r2(revenue - total), marginPct: revenue > 0 ? Math.round(((revenue - total) / revenue) * 100) : null, limits,
  };
}

export const SCENARIOS = [100, 500, 1_000, 2_500];
