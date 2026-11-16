import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, FileSignature, ShieldCheck, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { CONSENT_VERSION, isEsignEnabled } from "@/lib/esign/config";
import { formatCurrency } from "@/lib/estimate/money";
import { changeOrderAcceptanceText, changeOrderConsentText } from "@/lib/operations/change-orders";
import { loadCoRequest } from "@/lib/operations/co-signing";
import { site } from "@/lib/site";
import { CoSignForm } from "./co-sign-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review and sign your change order", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

const KIND: Record<string, string> = { add: "Added", remove: "Removed", modify: "Changed" };
const money = (n: number) => `${n < 0 ? "−" : ""}${formatCurrency(Math.abs(n).toFixed(2))}`;

/** Customer page for one frozen change order version. The secret link is the only key. */
export default async function ChangeOrderSignPage({ params }: { params: Promise<{ token: string }> }) {
  if (!isEsignEnabled()) notFound();
  const { token } = await params;
  const r = await loadCoRequest(createAdminClient(), token);
  if (!r) return <Shell><State icon={<XCircle className="h-8 w-8 text-danger" aria-hidden />} title="This link isn't valid">Check that you opened the full link your contractor sent. If it still doesn&apos;t work, ask them for a new one.</State></Shell>;
  const c = r.content;
  if (r.phase === "expired" || r.phase === "revoked") {
    return <Shell company={r.companyName}><State icon={<Clock className="h-8 w-8 text-warn" aria-hidden />} title={r.phase === "expired" ? "This link has expired" : "This link is no longer active"}>{r.companyName} may have sent an updated change order. Please contact them{r.contact ? <>: <span className="font-semibold">{r.contact}</span></> : "."}</State></Shell>;
  }
  const signed = r.phase === "signed";
  return (
    <Shell company={r.companyName}>
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6" aria-labelledby="co-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">Change order #{c.number} · version {c.version}</p>
            <h1 id="co-h" className="mt-1 font-display text-2xl font-extrabold text-navy sm:text-3xl">{c.title}</h1>
            <p className="mt-1 text-sm text-ink-soft">{c.project.title}{c.project.number ? ` · proposal #${c.project.number}` : ""}{c.project.projectAddress ? ` · ${c.project.projectAddress}` : ""}</p>
          </div>
          {signed ? <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-tint px-3 py-1 text-sm font-bold text-ok"><CheckCircle2 className="h-4 w-4" aria-hidden /> Signed</span>
            : <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1 text-sm font-bold text-navy"><FileSignature className="h-4 w-4" aria-hidden /> Ready for your signature</span>}
        </div>
        {c.description && <p className="mt-3 whitespace-pre-line text-ink-soft">{c.description}</p>}
        <table className="mt-4 w-full text-sm">
          <thead><tr className="border-b border-line text-left text-muted"><th className="py-1.5 font-semibold">Change</th><th className="py-1.5 font-semibold">Scope</th><th className="py-1.5 text-right font-semibold">Price</th></tr></thead>
          <tbody>{c.lines.map((l, i) => <tr key={i} className="border-b border-line/60 align-top"><td className="py-2 pr-3 font-semibold">{KIND[l.kind] ?? l.kind}</td><td className="whitespace-pre-line py-2 pr-3">{l.description}</td><td className="tabular py-2 text-right">{money(Number(l.amount))}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2} className="pt-3 font-bold">Change to contract price</td><td className="tabular pt-3 text-right text-lg font-extrabold text-navy">{money(Number(c.amount))}</td></tr></tfoot>
        </table>
        {c.scheduleDays ? <p className="mt-3 text-sm text-ink-soft">Schedule impact: {c.scheduleDays > 0 ? `adds ${c.scheduleDays}` : `saves ${Math.abs(c.scheduleDays)}`} working day{Math.abs(c.scheduleDays) === 1 ? "" : "s"}.</p> : null}
        {c.customerNotes && <p className="mt-3 whitespace-pre-line rounded-lg bg-paper p-3 text-sm text-ink-soft">{c.customerNotes}</p>}
      </section>
      <section className="mt-6 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6" aria-labelledby="sign-h">
        <h2 id="sign-h" className="font-display text-xl font-extrabold text-navy">{signed ? "Signature recorded" : "Approve & sign"}</h2>
        {signed ? <p className="mt-2 text-ink-soft">Signed by {r.signature?.signerName} on {new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(r.signature?.signedAt ?? Date.now()))}. Keep this link for your records.</p>
          : <CoSignForm token={token} customerName={c.project.customerName ?? ""} consentVersion={CONSENT_VERSION} consent={changeOrderConsentText(r.companyName)}
              acceptance={changeOrderAcceptanceText({ companyName: r.companyName, number: c.number, projectTitle: c.project.title, amount: c.amount, version: c.version })} />}
      </section>
      <p className="mt-6 flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>This link is private to you. Signing records your name, email, typed signature, the time, and your device&apos;s IP address and browser with this exact version of the change order. Signing does not process any payment.</span></p>
    </Shell>
  );
}

function Shell({ company, children }: { company?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface"><div className="mx-auto flex max-w-[860px] items-center justify-between gap-3 px-4 py-3"><span className="truncate font-display font-extrabold text-navy">{company ?? "Change order"}</span><span className="shrink-0 text-xs text-muted">Secure signing by {site.name}</span></div></header>
      <main id="main" className="mx-auto max-w-[860px] px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
function State({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-sm sm:p-10"><div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-black/5">{icon}</div><h1 className="font-display text-2xl font-extrabold text-navy">{title}</h1><p className="mx-auto mt-2 max-w-md text-ink-soft">{children}</p></div>;
}
