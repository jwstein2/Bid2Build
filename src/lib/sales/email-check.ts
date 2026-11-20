/**
 * Can a lead's email address actually receive mail? A DNS-only check (nothing is ever sent):
 *   1. the domain must publish MX records (a domain with none, or a "null MX" of ".", refuses mail);
 *   2. at least one MX host must itself resolve to an address (A or AAAA).
 * Step 2 is what an MX-only check misses: decksbyryan.com publishes an MX pointing at a hosting
 * provider's server name that no longer exists (NXDOMAIN), so every message to it bounces.
 *
 * Results: "ok", "undeliverable" (DNS gave a definite no) or "unknown" (DNS timed out or failed, so we
 * can't say). Only "undeliverable" is shown as a bad email; "unknown" is retried later.
 */
import { Resolver } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadEmailStatus } from "@/lib/sales/crm";

export type EmailCheckStatus = "ok" | "undeliverable" | "unknown";
export interface EmailCheck { status: EmailCheckStatus; reason: string }

/** The DNS lookups the check needs; injectable for tests. */
export interface MailDns {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
}

/** Codes that mean "this name definitely has no such record" (vs. a lookup that failed). */
const NO_RECORD = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);
const code = (e: unknown) => (e as { code?: string })?.code ?? "";

function systemDns(): MailDns {
  const r = new Resolver({ timeout: 2500, tries: 2 });
  return { resolveMx: (d) => r.resolveMx(d), resolve4: (h) => r.resolve4(h), resolve6: (h) => r.resolve6(h) };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms))]);
}

/** Does this host resolve to an address? true / false (definitely not) / null (lookup failed). */
async function hostResolves(dns: MailDns, host: string, ms: number): Promise<boolean | null> {
  const tries = await Promise.allSettled([withTimeout(dns.resolve4(host), ms), withTimeout(dns.resolve6(host), ms)]);
  if (tries.some((t) => t.status === "fulfilled" && t.value.length > 0)) return true;
  const definite = tries.every((t) => t.status === "fulfilled" || NO_RECORD.has(code(t.reason)));
  return definite ? false : null;
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  const d = at > 0 ? email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "") : "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

/** Check one mail domain. */
export async function checkMailDomain(domain: string, dns: MailDns = systemDns(), ms = 4000): Promise<EmailCheck> {
  let mx: { exchange: string; priority: number }[];
  try {
    mx = await withTimeout(dns.resolveMx(domain), ms);
  } catch (e) {
    if (code(e) === "ENOTFOUND" || code(e) === "NXDOMAIN") return { status: "undeliverable", reason: `The domain ${domain} doesn't exist.` };
    if (code(e) === "ENODATA") return { status: "undeliverable", reason: `${domain} has no mail server (no MX record).` };
    return { status: "unknown", reason: `Mail lookup for ${domain} failed (${code(e) || "error"}); will retry.` };
  }
  const hosts = [...new Set(mx.filter((m) => m.exchange && m.exchange !== ".").sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase().replace(/\.$/, "")))].slice(0, 5);
  if (hosts.length === 0) return { status: "undeliverable", reason: mx.length ? `${domain} says it doesn't accept mail (null MX).` : `${domain} has no mail server (no MX record).` };
  const results = await Promise.all(hosts.map((h) => hostResolves(dns, h, ms)));
  if (results.some((r) => r === true)) return { status: "ok", reason: `Mail server ${hosts[results.indexOf(true)]} found.` };
  if (results.every((r) => r === false)) {
    return { status: "undeliverable", reason: `${domain}'s mail server ${hosts.join(", ")} doesn't exist, so mail to it bounces.` };
  }
  return { status: "unknown", reason: `Couldn't confirm ${domain}'s mail server; will retry.` };
}

/** Check many addresses, one DNS check per domain. Keyed by lowercased email. */
export async function checkEmails(emails: string[], dns?: MailDns): Promise<Map<string, EmailCheck>> {
  const byDomain = new Map<string, string[]>();
  const out = new Map<string, EmailCheck>();
  for (const raw of emails) {
    const e = raw.trim().toLowerCase();
    if (!e || out.has(e)) continue;
    const d = emailDomain(e);
    if (!d) { out.set(e, { status: "undeliverable", reason: "That isn't a valid email address." }); continue; }
    byDomain.set(d, [...(byDomain.get(d) ?? []), e]);
  }
  const domains = [...byDomain.keys()];
  // A few at a time so a big batch doesn't flood the resolver.
  for (let i = 0; i < domains.length; i += 10) {
    const chunk = domains.slice(i, i + 10);
    const res = await Promise.all(chunk.map((d) => checkMailDomain(d, dns)));
    chunk.forEach((d, j) => { for (const e of byDomain.get(d)!) out.set(e, res[j]); });
  }
  return out;
}

/** Addresses on the known-bad list (real bounces), lowercased. Empty if the table isn't there yet. */
export async function knownBadEmails(admin: SupabaseClient, emails: string[]): Promise<Set<string>> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return new Set();
  const { data, error } = await admin.from("sales_bad_emails").select("email").in("email", list.slice(0, 1000));
  if (error) return new Set();
  return new Set((data ?? []).map((r: { email: string }) => r.email));
}

interface LeadEmailRow { id: string; email: string | null; email_status?: string | null }

/**
 * Check these leads' emails and store the result on each lead. A lead marked "bounced" by a person stays
 * bounced; an address on the known-bad list becomes bounced. Returns counts. Service-role client only.
 */
export async function applyEmailChecks(admin: SupabaseClient, leads: LeadEmailRow[], dns?: MailDns): Promise<{ checked: number; ok: number; bad: number; unknown: number }> {
  const todo = leads.filter((l) => l.email && l.email_status !== "bounced");
  const counts = { checked: 0, ok: 0, bad: 0, unknown: 0 };
  if (!todo.length) return counts;
  const emails = todo.map((l) => l.email!.toLowerCase());
  const [checks, bad] = await Promise.all([checkEmails(emails, dns), knownBadEmails(admin, emails)]);
  const now = new Date().toISOString();
  for (const l of todo) {
    const e = l.email!.toLowerCase();
    const c = checks.get(e) ?? { status: "unknown" as const, reason: "Not checked." };
    const status: LeadEmailStatus | null = bad.has(e) ? "bounced" : c.status === "unknown" ? null : c.status;
    counts.checked++;
    if (status === "ok") counts.ok++; else if (status) counts.bad++; else counts.unknown++;
    // Unknown: leave the status as it was, just note the attempt so the sweep moves on.
    const patch = status
      ? { email_status: status, email_checked_at: now, email_check_note: bad.has(e) ? "This address bounced before (known-bad list)." : c.reason }
      : { email_checked_at: now, email_check_note: c.reason };
    // Only if the email is still the one we checked (it may have been edited meanwhile).
    await admin.from("sales_leads").update(patch).eq("id", l.id).eq("email", l.email!);
  }
  return counts;
}

/**
 * Sweep: check leads never checked (or, with all=true, every lead with an email, oldest check first).
 * Used by the daily sales job and the admin "Recheck emails" button.
 */
export async function recheckLeadEmails(admin: SupabaseClient, opts: { all?: boolean; limit?: number } = {}) {
  let q = admin.from("sales_leads").select("id, email, email_status").not("email", "is", null).neq("email_status", "bounced");
  if (!opts.all) q = q.eq("email_status", "unchecked");
  const { data, error } = await q.order("email_checked_at", { ascending: true, nullsFirst: true }).limit(Math.min(opts.limit ?? 200, 1000));
  if (error) return { checked: 0, ok: 0, bad: 0, unknown: 0, error: error.message };
  return applyEmailChecks(admin, (data ?? []) as LeadEmailRow[]);
}

/** A person saw a real bounce: mark the lead bounced and remember the address so imports skip it. */
export async function markEmailBounced(admin: SupabaseClient, leadId: string, note: string | null, by: string | null): Promise<boolean> {
  const { data: lead } = await admin.from("sales_leads").select("id, email").eq("id", leadId).maybeSingle();
  const email = (lead as { email: string | null } | null)?.email?.toLowerCase();
  if (!email) return false;
  const text = (note ?? "").trim().slice(0, 300) || "Marked as bounced.";
  await admin.from("sales_bad_emails").upsert({ email, reason: "bounced", note: text, created_by: by }, { onConflict: "email" });
  const { error } = await admin.from("sales_leads").update({ email_status: "bounced", email_checked_at: new Date().toISOString(), email_check_note: text }).eq("email", email);
  return !error;
}
