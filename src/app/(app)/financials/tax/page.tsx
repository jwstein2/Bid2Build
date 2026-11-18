import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { Badge, Notice } from "@/components/ui/misc";
import { TbShell } from "@/components/tax-banking/shell";
import { AlertActions, ExemptionForm, RevokeExemption, TaxProfileForm } from "@/components/tax-banking/tax";
import { TAX_AUTHORITIES } from "@/lib/tax-banking/authorities";
import { can } from "@/lib/tax-banking/capabilities";
import { loadTaxPage } from "@/lib/tax-banking/load";
import { fmtDateServer, fmtWhen } from "@/lib/financials/accounting-format";

export const metadata: Metadata = { title: "Tax & regulatory updates", robots: { index: false } };
type Row = Record<string, unknown>;
const STALE_DAYS = 8;
const olderThanDays = (d: Date | null, n: number) => !d || Date.now() - d.getTime() > n * 864e5;

/**
 * Tax & Regulatory Updates. Rates come from a licensed tax service; Built2Bid keeps the last verified rate when the
 * service is down and says so. Rule (taxability) changes are never applied automatically. Nothing here files a
 * return, emails anyone, or guarantees compliance.
 */
export default async function TaxPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!isFinancialsEnabled()) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const state = await loadFinState(db);
  const shell = { state, title: "Tax & regulatory updates", active: "tax" as const, cap: "tax.view_config" as const };
  if (state.kind !== "ready" || !can(state.ctx.access.permissions, "tax.view_config")) return <TbShell {...shell} />;
  const { ctx } = state;
  const perms = ctx.access.permissions;
  const canEdit = ctx.access.active && !ctx.access.readOnly && can(perms, "tax.manage_settings");
  const canAct = ctx.access.active && !ctx.access.readOnly && can(perms, "tax.review_alerts");
  const t = await loadTaxPage(db, ctx.bookId, perms);
  if (!t.installed) return <TbShell {...shell}><Notice title="Tax updates turn on after the database update">The V6.9 SQL (20261226001000) hasn&apos;t been installed on this database yet. Nothing else is affected.</Notice></TbShell>;
  const states = TAX_AUTHORITIES.map((a) => ({ code: a.state, name: a.stateName }));
  const p = t.profile;
  const profile = {
    primaryState: (p?.primary_state as string | null) ?? null, serviceStates: (p?.service_states as string[] | undefined) ?? [], address: (p?.address as Record<string, string> | null) ?? null,
    registrations: (p?.registrations as { state: string; registered: boolean }[] | undefined) ?? [], businessType: (p?.business_type as string | null) ?? null, workMix: (p?.work_mix as string | null) ?? null,
    defaultContract: (p?.default_contract as string | null) ?? null, autoApplyRates: (p?.auto_apply_rates as boolean | undefined) ?? true, notifyImmediate: (p?.notify_immediate as boolean | undefined) ?? true,
    notifyQuarterly: (p?.notify_quarterly as boolean | undefined) ?? true, notifyEmail: (p?.notify_email as boolean | undefined) ?? false,
  };
  const f = t.freshness;
  const lastOk = f?.lastSuccessAt ? new Date(f.lastSuccessAt) : null;
  const stale = olderThanDays(lastOk, STALE_DAYS);
  const open = t.alerts.filter((a) => a.status === "new");
  const done = t.alerts.filter((a) => a.status !== "new").slice(0, 20);
  const view = sp.view === "authorities" ? "authorities" : sp.view === "setup" ? "setup" : "updates";
  const { data: customers } = canEdit ? await db.from("customers").select("id, name").order("name").limit(1000) : { data: [] };
  const custName = new Map(((customers ?? []) as Row[]).map((c) => [String(c.id), String(c.name)]));
  const authMap = new Map(t.authorities.map((a) => [String(a.state), a]));

  return (
    <TbShell {...shell} intro="Rate and rule changes for the states you work in, from a licensed tax service and the official state tax agencies. Rates update on their effective date; anything about what is taxable waits for your review. Built2Bid helps you stay current but doesn't guarantee compliance; check with your tax professional.">
      {t.providerMode === "none" ? (
        <Notice tone="warn" title="Live tax rates are coming soon">No tax service is switched on yet, so tax uses the rate you type on each bid and says so. Turning one on needs the owner&apos;s approval (it has a cost).</Notice>
      ) : stale ? (
        <Notice tone="warn" title="Tax data may be out of date">The last successful rate update was {lastOk ? fmtWhen(lastOk.toISOString()) : "never"}. Built2Bid keeps using the last verified rates and flags calculations for review. It never guesses a rate.</Notice>
      ) : (
        <p className="text-sm text-muted" data-testid="tax-fresh">Rates last updated {fmtWhen(lastOk!.toISOString())} from {f?.provider ?? "the tax service"}.</p>
      )}
      <nav aria-label="Tax views" className="flex flex-wrap gap-2 text-sm">
        {([["updates", `Updates${open.length ? ` (${open.length})` : ""}`], ["setup", "Tax setup & exemptions"], ["authorities", "State tax agencies"]] as const).map(([k, l]) => (
          <a key={k} href={`/financials/tax?view=${k}`} aria-current={view === k ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-full border px-3 font-semibold ${view === k ? "border-brand bg-brand-tint" : "border-line"}`}>{l}</a>
        ))}
      </nav>

      {view === "updates" && (
        <section aria-labelledby="tax-alerts-h" className="space-y-3">
          <h2 id="tax-alerts-h" className="font-display text-lg font-extrabold">Needs your attention</h2>
          {!open.length && <p className="text-sm text-muted">Nothing new. {profile.serviceStates.length || profile.primaryState ? "" : "Add the states you work in under Tax setup so changes there show up here."}</p>}
          <ul className="space-y-3">
            {open.map((a) => (
              <li key={String(a.id)} className="rounded-xl border border-line bg-surface p-4" data-testid="tax-alert">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{String(a.title)}</span>
                  {Boolean(a.review_needed) && <Badge tone="warn">Needs review</Badge>}
                  {Boolean(a.auto_updated) && <Badge tone="ok">Rate updates automatically</Badge>}
                  {a.kind === "digest" && <Badge tone="brand">Quarterly summary</Badge>}
                </div>
                <p className="mt-1 text-sm text-ink-soft">{String(a.impact ?? "")}</p>
                <p className="mt-1 text-xs text-muted">{a.state ? `${authMap.get(String(a.state))?.state_name ?? a.state}${a.locality ? ` · ${a.locality}` : ""} · ` : ""}{a.effective_date ? `Effective ${fmtDateServer(String(a.effective_date))}` : ""}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {Boolean(a.source_url) && <a href={String(a.source_url)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent-ink underline">View official source <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>}
                  {Boolean(a.review_needed) && <Link href="/dashboard" className="inline-flex min-h-9 items-center text-sm font-semibold text-accent-ink underline">Review affected drafts</Link>}
                  <AlertActions id={String(a.id)} canAct={canAct} />
                </div>
              </li>
            ))}
          </ul>
          {t.changes.length > 0 && (
            <details className="rounded-xl border border-line bg-surface p-4">
              <summary className="cursor-pointer font-semibold">Recent and upcoming changes ({t.changes.length})</summary>
              <div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-3">State</th><th className="pr-3">What</th><th className="pr-3">Effective</th><th>Status</th></tr></thead>
                <tbody>{t.changes.map((c) => <tr key={String(c.id)} className="border-t border-line"><td className="py-1.5 pr-3">{String(c.state)}</td><td className="pr-3">{String(c.summary)}</td><td className="pr-3 whitespace-nowrap">{fmtDateServer(String(c.effective_date))}</td><td><Badge tone={c.status === "needs_review" ? "warn" : c.status === "active" ? "ok" : "neutral"}>{String(c.status).replace(/_/g, " ")}</Badge></td></tr>)}</tbody></table></div>
            </details>
          )}
          {done.length > 0 && (
            <details className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-sm font-semibold">Reviewed and dismissed ({done.length})</summary>
              <ul className="mt-2 divide-y divide-line text-sm">{done.map((a) => <li key={String(a.id)} className="py-1.5">{String(a.title)} <span className="text-muted">· {String(a.status)}{a.acted_at ? ` ${fmtWhen(String(a.acted_at))}` : ""}</span></li>)}</ul></details>
          )}
        </section>
      )}

      {view === "setup" && (
        <div className="space-y-4">
          <TaxProfileForm initial={profile} states={states} canEdit={canEdit} />
          <section aria-labelledby="tax-ex-h" className="space-y-2">
            <h2 id="tax-ex-h" className="font-display text-lg font-extrabold">Exemption certificates</h2>
            {canEdit && <ExemptionForm customers={((customers ?? []) as Row[]).map((c) => ({ id: String(c.id), label: String(c.name) }))} states={states} />}
            {t.exemptions.length ? (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {t.exemptions.map((x) => {
                  const expired = x.expires_on && String(x.expires_on) < new Date().toISOString().slice(0, 10);
                  return (
                    <li key={String(x.id)} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                      <span className="font-semibold">{custName.get(String(x.customer_id)) ?? "Customer"}</span><span className="text-muted">{String(x.state)} · {String(x.reason).replace(/_/g, " ")}{x.certificate_ref ? ` · ref ${x.certificate_ref}` : ""}</span>
                      {x.status !== "active" ? <Badge>Revoked</Badge> : expired ? <Badge tone="danger">Expired {fmtDateServer(String(x.expires_on))}</Badge> : !x.certificate_ref && !x.document_id ? <Badge tone="warn">No certificate on file</Badge> : <Badge tone="ok">{x.expires_on ? `Valid to ${fmtDateServer(String(x.expires_on))}` : "On file"}</Badge>}
                      {canEdit && x.status === "active" && <RevokeExemption id={String(x.id)} />}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-muted">No exemptions recorded.</p>}
          </section>
        </div>
      )}

      {view === "authorities" && (
        <section aria-labelledby="tax-auth-h" className="space-y-2">
          <h2 id="tax-auth-h" className="font-display text-lg font-extrabold">Official state tax agencies (50 states + DC)</h2>
          <p className="text-sm text-ink-soft">Links go to each agency&apos;s own site. &ldquo;Needs verification&rdquo; means Built2Bid hasn&apos;t confirmed the link recently; it never invents an agency or a feed.</p>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm" data-testid="tax-authorities">
              <thead><tr className="text-left text-xs text-muted"><th className="p-2">State</th><th className="p-2">Agency</th><th className="p-2">Sales tax</th><th className="p-2">Link status</th></tr></thead>
              <tbody>{TAX_AUTHORITIES.map((a) => { const row = authMap.get(a.state); const st = String(row?.source_status ?? "needs_verification"); return (
                <tr key={a.state} className="border-t border-line">
                  <td className="p-2 font-semibold">{a.stateName}</td>
                  <td className="p-2"><a href={a.website} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline">{a.authority}</a></td>
                  <td className="p-2 text-ink-soft">{a.system === "none" || a.system === "local_only" ? "No general state sales tax" : a.sst ? "Streamlined (SST) member" : "State sales tax"}{a.note ? ` · ${a.note}` : ""}</td>
                  <td className="p-2"><Badge tone={st === "reachable" ? "ok" : st === "unreachable" ? "danger" : "neutral"}>{st.replace(/_/g, " ")}</Badge>{row?.last_checked_at ? <span className="ml-1 text-xs text-muted">{fmtWhen(String(row.last_checked_at))}</span> : null}</td>
                </tr>); })}</tbody>
            </table>
          </div>
        </section>
      )}
    </TbShell>
  );
}
