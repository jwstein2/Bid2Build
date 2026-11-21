import "server-only";
/**
 * V9 daily step, run from the existing tax-banking cron: for each real (non-sandbox) book that has saved forecast
 * settings, compute the standard forecast (expected scenario, saved cost mode, 90 days), refresh early-warning alerts,
 * keep today's snapshot, and (only if that company turned alert email on) send one short email listing new warnings to
 * the people it chose. Never sends an invoice, moves money or contacts a customer. Returns counts only.
 */
import type { createAdminClient } from "@/lib/supabase/server";
import { commConfig, type CommConfig } from "@/lib/comms/config";
import { fromHeader, newRfcMessageId, sendCommEmail } from "@/lib/comms/send";
import { logError } from "@/lib/http/api";
import { site } from "@/lib/site";
import { isDemoTenant } from "@/lib/demo/guard";
import { buildV9 } from "./engine";
import { isCashV9Enabled, loadV9 } from "./load";
import { alertsFor, persist, previousSnapshot } from "./run";

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;
/** The daily job sees the company's full books, as the owner would. */
const FULL = ["view_company_financials", "reconcile"] as const;

export interface AlertMailItem { severity: string; title: string; body: string; href: string | null }

/** Plain-text digest. Pure, for tests. */
export function alertDigest(companyName: string, items: AlertMailItem[], base: string): { subject: string; text: string } {
  const crit = items.filter((i) => i.severity === "critical").length;
  const subject = `${crit ? "Action needed: " : ""}${items.length} new cash-flow warning${items.length === 1 ? "" : "s"} for ${companyName}`;
  const lines = items.map((i) => `• ${i.severity === "critical" ? "[Critical] " : ""}${i.title}\n  ${i.body}${i.href ? `\n  ${base}${i.href}` : ""}`);
  const text = [`Built2Bid found ${items.length === 1 ? "a new warning" : "new warnings"} in ${companyName}'s cash forecast:`, "", ...lines, "",
    "These are forecasts based on your schedules, invoices, bills and settings, not guarantees. Nothing was sent to customers and no money was moved.",
    `Open Cash flow: ${base}/financials/cash`, `Change who gets these emails: ${base}/financials/cash/settings`].join("\n");
  return { subject, text };
}

export async function runCashV9Daily(admin: Admin, today: string, cfg: CommConfig = commConfig(), fetchImpl: typeof fetch = fetch) {
  const out = { books: 0, alerts: 0, emailed: 0, skipped: 0 };
  if (!isCashV9Enabled()) return out;
  const { data, error } = await admin.from("fin_cash_settings").select("book_id, alert_email, alert_recipients").limit(1000);
  if (error) { if (!/does not exist|schema cache/.test(error.message ?? "")) logError("cash_v9.daily", error); return out; }
  for (const s of (data ?? []) as Row[]) {
    const bookId = String(s.book_id);
    try {
      const { data: book } = await admin.from("fin_books").select("company_id, owner_user_id, sandbox_of").eq("id", bookId).maybeSingle();
      const b = book as Row | null;
      if (!b || b.sandbox_of) { out.skipped++; continue; }
      const d = await loadV9(admin, bookId, FULL, { horizon: 90 }, today);
      if (!d.installed) continue;
      const mode = d.settings.expenseMode;
      const r = buildV9(d.base, d.data, { scenario: "expected", mode, whatIf: [] });
      const alerts = alertsFor(r, d.data, d.base, today, await previousSnapshot(admin, bookId, today));
      await persist(admin, bookId, r, alerts, today, { mode, scenario: "expected", horizon: 90, source: "daily" });
      out.books++; out.alerts += alerts.length;
      if (s.alert_email === true) out.emailed += await emailNew(admin, bookId, b, (s.alert_recipients ?? []) as string[], cfg, today, fetchImpl);
    } catch (e) { logError("cash_v9.book", e); out.skipped++; }
  }
  return out;
}

async function emailNew(admin: Admin, bookId: string, b: Row, recipients: string[], cfg: CommConfig, today: string, fetchImpl: typeof fetch): Promise<number> {
  if (!cfg.enabled || !recipients.length) return 0;
  const tenant = (b.company_id ?? b.owner_user_id) as string | null;
  if (await isDemoTenant(admin, tenant) || await isDemoTenant(admin, b.owner_user_id as string | null)) return 0;
  const { data } = await admin.from("fin_cash_alerts").select("id, severity, title, body, actions").eq("book_id", bookId).eq("status", "open").is("notified_at", null)
    .in("severity", ["warning", "critical"]).order("first_seen_at", { ascending: true }).limit(20);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return 0;
  let name = "your company";
  if (b.company_id) { const { data: c } = await admin.from("companies").select("name").eq("id", String(b.company_id)).maybeSingle(); name = String((c as Row | null)?.name || name); }
  const base = site.url.replace(/\/+$/, "");
  const mail = alertDigest(name, rows.map((x) => ({ severity: String(x.severity), title: String(x.title), body: String(x.body ?? ""), href: (((x.actions ?? []) as { href?: string }[])[0]?.href) ?? null })), base);
  let sent = 0;
  for (const uid of recipients.slice(0, 20)) {
    const { data: u } = await admin.auth.admin.getUserById(uid);
    const to = String(u?.user?.email ?? "").trim().toLowerCase();
    if (!to || (cfg.mode === "test" && !cfg.testRecipients.includes(to))) continue;
    const res = await sendCommEmail(cfg.apiKey, { idempotencyKey: `cash-alerts/${bookId}/${uid}/${today}`, from: fromHeader("Built2Bid", cfg.fromAddress), to, replyTo: null,
      subject: mail.subject, text: mail.text, messageId: newRfcMessageId(), tags: [{ name: "kind", value: "cash_alerts" }] }, fetchImpl);
    if (res.ok) sent++; else logError("cash_v9.send", res.error);
  }
  if (sent) await admin.rpc("fin_cash_alerts_mark_notified", { p_ids: rows.map((x) => String(x.id)) });
  return sent;
}
