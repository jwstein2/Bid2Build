import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { hashSigningToken, isSigningToken } from "@/lib/esign/token";
import { piiReady } from "@/lib/security/pii";
import { site } from "@/lib/site";
import type { SubRequestKind } from "@/lib/team/sub-requests";
import { SubDocsForm } from "./sub-docs-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Send your paperwork", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

type View = { state: "open" | "not_found" | "revoked" | "completed" | "expired"; subName?: string; contractor?: string; kinds?: SubRequestKind[]; note?: string | null; expiresAt?: string };

/**
 * A subcontractor's secure page for their W-9 and certificates. No account: the secret link from the contractor is
 * the key. Shows only the contractor's name, the sub's name and what was asked for.
 */
export default async function SubDocsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bad = <Shell><State icon={<XCircle className="h-8 w-8 text-danger" aria-hidden />} title="This link isn't valid">Check that you opened the full link your contractor sent. If it still doesn&apos;t work, ask them for a new one.</State></Shell>;
  if (!isSigningToken(token)) return bad;
  const { data } = await createAdminClient().rpc("pm_sub_request_lookup", { p_token_hash: hashSigningToken(token) });
  const v = (data ?? null) as View | null;
  if (!v || v.state === "not_found") return bad;
  if (v.state === "completed") return <Shell><State icon={<CheckCircle2 className="h-8 w-8 text-ok" aria-hidden />} title="Already sent">Thank you. Your contractor has your paperwork. You can close this page.</State></Shell>;
  if (v.state !== "open") return <Shell><State icon={<Clock className="h-8 w-8 text-warn" aria-hidden />} title="This link is no longer active">Please ask your contractor for a new link.</State></Shell>;
  const contractor = v.contractor ?? "Your contractor";
  return (
    <Shell company={contractor}>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold text-navy">Send your paperwork to {contractor}</h1>
        <p className="text-ink-soft">{contractor} asked {v.subName} for the items below. Fill in what you can and send it in one go. It takes a few minutes.</p>
        {v.note && <p className="rounded-xl border border-line bg-surface p-3 text-sm text-ink-soft"><span className="font-semibold text-ink">Note from {contractor}: </span>{v.note}</p>}
      </div>
      <SubDocsForm token={token} contractor={contractor} subName={v.subName ?? ""} kinds={v.kinds ?? []} w9Available={piiReady()} />
    </Shell>
  );
}

function Shell({ company, children }: { company?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-3 px-4 py-3">
          <span className="truncate font-display font-extrabold text-navy">{company ?? "Subcontractor paperwork"}</span>
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
