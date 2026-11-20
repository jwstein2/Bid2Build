import "server-only";
import type { createAdminClient } from "@/lib/supabase/server";
import { commConfig, type CommConfig } from "@/lib/comms/config";
import { fromHeader, newRfcMessageId, sendCommEmail } from "@/lib/comms/send";
import { logError } from "@/lib/http/api";
import { site } from "@/lib/site";
import { complianceDigest, type ExpiryItem } from "@/lib/team/sub-requests";
import { isDemoTenant } from "@/lib/demo/guard";

type Admin = ReturnType<typeof createAdminClient>;
type Due = { doc_id: string; stage: ExpiryItem["stage"]; company_id: string | null; owner_id: string | null; resource_id: string; sub_name: string; doc_type: string; expires_on: string };
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/**
 * Daily: one email per account listing sub certificates that expire in 30 days, in 7 days, or have expired.
 * Each document gets each notice once (pm_compliance_notices). Goes to the account owner from Built2Bid.
 * Sends nothing while customer email is off; notices stay due and go out once it's on.
 */
export async function runComplianceNotices(admin: Admin, today: string, cfg: CommConfig = commConfig(), fetchImpl: typeof fetch = fetch): Promise<{ accounts: number; sent: number; skipped: number }> {
  const out = { accounts: 0, sent: 0, skipped: 0 };
  if (!cfg.enabled) return out;
  const { data, error } = await admin.rpc("pm_compliance_due", { p_today: today });
  if (error) { if (!/does not exist|schema cache/.test(error.message ?? "")) logError("compliance.due", error); return out; }
  const groups = new Map<string, Due[]>();
  for (const r of (data ?? []) as Due[]) {
    const k = r.company_id ? `c:${r.company_id}` : `o:${r.owner_id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, rows] of groups) {
    out.accounts++;
    let ownerId = k.startsWith("o:") ? k.slice(2) : null;
    let companyName: string | null = null;
    if (k.startsWith("c:")) {
      const { data: c } = await admin.from("companies").select("name, owner_user_id").eq("id", k.slice(2)).maybeSingle();
      ownerId = (c as { owner_user_id?: string } | null)?.owner_user_id ?? null;
      companyName = (c as { name?: string } | null)?.name ?? null;
    }
    if (!ownerId) { out.skipped++; continue; }
    // Demo / practice sample companies never get email (their subs and documents are fictional).
    if (await isDemoTenant(admin, ownerId) || (k.startsWith("c:") && await isDemoTenant(admin, k.slice(2)))) { out.skipped++; continue; }
    const { data: bp } = await admin.from("business_profiles").select("company_name, email").eq("user_id", ownerId).maybeSingle();
    let to = String((bp as { email?: string } | null)?.email ?? "").trim().toLowerCase();
    if (!to) { const { data: u } = await admin.auth.admin.getUserById(ownerId); to = String(u?.user?.email ?? "").toLowerCase(); }
    if (!to || (cfg.mode === "test" && !cfg.testRecipients.includes(to))) { out.skipped++; continue; }
    const name = companyName || (bp as { company_name?: string } | null)?.company_name || "your company";
    // Only the latest stage per document matters in one email.
    const items: ExpiryItem[] = rows.map((r) => ({ subName: r.sub_name, docType: r.doc_type, expiresOn: day(r.expires_on), stage: r.stage }));
    const mail = complianceDigest({ companyName: name, items, link: `${site.url.replace(/\/+$/, "")}/projects/team/subs`, today });
    const res = await sendCommEmail(cfg.apiKey, {
      idempotencyKey: `compliance/${k}/${today}`, from: fromHeader("Built2Bid", cfg.fromAddress), to, replyTo: null,
      subject: mail.subject, text: mail.text, messageId: newRfcMessageId(), tags: [{ name: "kind", value: "sub_compliance" }],
    }, fetchImpl);
    if (!res.ok) { logError("compliance.send", res.error); out.skipped++; continue; }
    // Record every stage that applies (a doc found already expired also counts as past its 30/7-day notices).
    const marks = rows.flatMap((r) => (r.stage === "expired" ? ["30_days", "7_days", "expired"] : r.stage === "7_days" ? ["30_days", "7_days"] : ["30_days"]).map((stage) => ({ doc_id: r.doc_id, stage })));
    const { error: me } = await admin.from("pm_compliance_notices").upsert(marks, { onConflict: "doc_id,stage", ignoreDuplicates: true });
    if (me) logError("compliance.mark", me);
    out.sent++;
  }
  return out;
}
