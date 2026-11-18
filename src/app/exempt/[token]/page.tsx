import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { hashSigningToken, isSigningToken } from "@/lib/esign/token";
import { TAX_AUTHORITIES } from "@/lib/tax-banking/authorities";
import { exemptionStatement } from "@/lib/tax-banking/tax/exemption-form";
import { site } from "@/lib/site";
import { ExemptForm } from "./exempt-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sales tax exemption certificate", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

type View = { status: "open" | "signed" | "revoked" | "expired"; company: string; customer: string; states: string[]; expiresAt: string; signedAt: string | null };

/**
 * Customer's online exemption certificate. No account and no uploads: the secret link from the contractor is the key.
 * Shows only the contractor's name, the customer's name and the suggested states.
 */
export default async function ExemptPage({ params }: PageProps<"/exempt/[token]">) {
  const { token } = await params;
  const bad = <Shell><State icon={<XCircle className="h-8 w-8 text-danger" aria-hidden />} title="This link isn't valid">Check that you opened the full link your contractor sent. If it still doesn&apos;t work, ask them for a new one.</State></Shell>;
  if (!isSigningToken(token)) return bad;
  const { data } = await createAdminClient().rpc("tax_exemption_request_view", { p_token_hash: hashSigningToken(token) });
  const v = (data ?? null) as View | null;
  if (!v) return bad;
  if (v.status === "signed") return <Shell company={v.company}><State icon={<CheckCircle2 className="h-8 w-8 text-ok" aria-hidden />} title="Certificate signed">Thank you. {v.company} has your exemption certificate on file. You can close this page.</State></Shell>;
  if (v.status !== "open") return <Shell company={v.company}><State icon={<Clock className="h-8 w-8 text-warn" aria-hidden />} title="This link is no longer active">Please ask {v.company} for a new link.</State></Shell>;
  return (
    <Shell company={v.company}>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold text-navy">Sales tax exemption certificate</h1>
        <p className="text-ink-soft">{v.company} asked {v.customer} to confirm a sales tax exemption. Fill in the form and sign by typing your name. It takes about two minutes. Nothing to print or upload.</p>
      </div>
      <ExemptForm token={token} customerName={v.customer} company={v.company} suggestedStates={v.states}
        states={TAX_AUTHORITIES.filter((a) => a.system !== "none").map((a) => ({ code: a.state, name: a.stateName }))}
        statementFor={exemptionStatement(v.company, "__PURCHASER__")} />
    </Shell>
  );
}

function Shell({ company, children }: { company?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-3 px-4 py-3">
          <span className="truncate font-display font-extrabold text-navy">{company ?? "Exemption certificate"}</span>
          <span className="shrink-0 text-xs text-muted">Secure form by {site.name}</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[760px] space-y-5 px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}

function State({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-sm sm:p-10">
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-black/5">{icon}</div>
      <h1 className="font-display text-2xl font-extrabold text-navy">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-ink-soft">{children}</p>
    </div>
  );
}
