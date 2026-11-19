import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, Download, FileSignature, ShieldCheck, XCircle } from "lucide-react";
import { ProposalView } from "@/components/proposal/proposal-view";
import { createAdminClient } from "@/lib/supabase/server";
import { acceptanceText, consentText, CONSENT_VERSION, isEsignEnabled } from "@/lib/esign/config";
import { loadLogo, loadRequestByToken, requestEvidence } from "@/lib/esign/server";
import { recordSigningEvent } from "@/lib/esign/events";
import Link from "next/link";
import { PrintButton } from "@/components/esign/print-button";
import { site } from "@/lib/site";
import { SignForm } from "./sign-form";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { executionFor, viewSignature } from "@/lib/esign/contractor/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Review and sign your proposal",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));

/**
 * Customer signing page. No account needed: the secret link is the only key. Shows only the frozen,
 * customer-facing proposal of the version that was sent (never the internal snapshot).
 */
export default async function SignPage({ params }: PageProps<"/sign/[token]">) {
  if (!isEsignEnabled()) notFound();
  const { token } = await params;
  const admin = createAdminClient();
  const r = await loadRequestByToken(admin, token);
  if (!r) return <Shell><State icon={<XCircle className="h-8 w-8 text-danger" aria-hidden />} title="This signing link isn't valid">Check that you opened the full link from your contractor&apos;s email or message. If it still doesn&apos;t work, ask them to send a new one.</State></Shell>;

  const doc = r.doc;
  const contact = doc.brand.contact.map((c) => c.value).filter(Boolean).join(" · ");
  if (r.phase === "expired" || r.phase === "revoked") {
    return (
      <Shell company={doc.brand.companyName}>
        <State icon={<Clock className="h-8 w-8 text-warn" aria-hidden />} title={r.phase === "expired" ? "This signing link has expired" : "This signing link is no longer active"}>
          {doc.brand.companyName} may have sent an updated proposal. Please contact them for a new link{contact ? <>: <span className="font-semibold">{contact}</span></> : "."}
        </State>
      </Shell>
    );
  }

  // Audit trail: each open of an unsigned link is recorded (best effort, never blocks the page).
  if (r.phase === "open") await recordSigningEvent(admin, r.id, "viewed", await requestEvidence());
  const logo = await loadLogo(admin, r.logoPath);
  const view = { ...doc, brand: { ...doc.brand, logoUrl: logo ? `data:image/png;base64,${logo.data.toString("base64")}` : null } };
  const proposalExpires = doc.meta.expires ? doc.meta.expires : null;
  const signed = r.phase === "signed";
  // V5.3: the contractor signature, when one is recorded on this version. Before the customer signs it
  // only appears if it was applied before the link was created (it is part of what they review).
  const ex = isContractorSigningEnabled() ? await executionFor(admin, { request_id: r.id, version_id: r.versionId }) : null;
  const contractorView = ex?.contractor && (signed || ex.contractor.applied_at <= r.createdAt) ? viewSignature(ex.contractor) : null;
  const executed = ex?.state === "fully_executed";
  const awaitingContractor = signed && ex?.state === "awaiting_contractor";

  return (
    <Shell company={doc.brand.companyName}>
      <section aria-labelledby="summary-h" className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6 no-print">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">Proposal from {doc.brand.companyName}</p>
            <h1 id="summary-h" className="mt-1 font-display text-2xl font-extrabold text-navy sm:text-3xl">{doc.meta.title}</h1>
          </div>
          {signed
            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-tint px-3 py-1 text-sm font-bold text-ok" data-testid="customer-status"><CheckCircle2 className="h-4 w-4" aria-hidden /> {executed ? "Fully executed" : awaitingContractor ? "Signed · awaiting contractor signature" : "Signed"}</span>
            : <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1 text-sm font-bold text-navy"><FileSignature className="h-4 w-4" aria-hidden /> Ready for your signature</span>}
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Item k="Prepared for" v={doc.customer.name} />
          <Item k="Project address" v={doc.customer.projectAddress} />
          <Item k="Proposal number" v={`#${doc.meta.number} (version ${r.versionNumber})`} />
          <Item k="Proposal total" v={doc.pricing.total} strong />
          {proposalExpires && <Item k="Proposal expires" v={proposalExpires} />}
          {!signed && <Item k="This link works until" v={fmtDate(r.expiresAt)} />}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="#proposal" className="inline-flex min-h-11 items-center rounded-lg bg-navy px-4 font-semibold text-white hover:bg-navy/90">Review the full proposal</a>
          <a href={`/api/sign/${token}/pdf`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 font-semibold text-navy hover:bg-black/5">
            <Download className="h-4 w-4" aria-hidden /> {executed ? "Download executed agreement (PDF)" : signed ? "Download signed copy (PDF)" : "Download PDF"}
          </a>
          <PrintButton />
        </div>
        {!signed && <p className="mt-2 text-xs text-muted">You can download or print a copy to keep before you sign.</p>}
      </section>

      <section id="proposal" aria-label="Full proposal" className="mt-6 scroll-mt-4 rounded-xl bg-[#e4eaf1] p-2 sm:p-5 print:mt-0 print:bg-transparent print:p-0">
        <div className="mb-2 flex flex-wrap justify-end gap-2 no-print">
          <a href={`/api/sign/${token}/pdf`} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-surface px-4 text-sm font-semibold text-navy shadow-sm hover:bg-white/80" data-testid="proposal-download">
            <Download className="h-4 w-4" aria-hidden /> Download PDF
          </a>
          <PrintButton className="bg-surface text-sm shadow-sm" label="Print" />
        </div>
        <ProposalView doc={view} contractorSignature={contractorView} />
      </section>

      <section aria-labelledby="sign-h" className="mt-6 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6 no-print" id="sign">
        <h2 id="sign-h" className="font-display text-xl font-extrabold text-navy">{signed ? "Signature recorded" : "Accept & sign"}</h2>
        {signed ? (
          <p className="mt-2 text-ink-soft">This proposal was accepted and signed electronically.{executed ? ` ${doc.brand.companyName} has also signed it, so the agreement is fully executed.` : awaitingContractor ? ` ${doc.brand.companyName} still needs to countersign it; until then this is your signed acceptance, not the fully executed agreement.` : ""} You can download your copy at any time from this page{contact ? <>, or contact {doc.brand.companyName} at <span className="font-semibold">{contact}</span></> : ""}.</p>
        ) : (
          <SignForm
            token={token}
            customerName={doc.customer.name}
            consentVersion={CONSENT_VERSION}
            consent={consentText(doc.brand.companyName)}
            acceptance={acceptanceText({ companyName: doc.brand.companyName, proposalNumber: doc.meta.number, projectTitle: doc.meta.title, total: doc.pricing.total })}
          />
        )}
      </section>
      <p className="mt-6 flex items-start gap-2 text-xs text-muted no-print">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>This link is private to you. Opening, downloading and signing are recorded with the time, your device&apos;s IP address and browser, and signing also records your name, email and signature with this exact version of the proposal. Signing does not process any payment. Questions about the proposal go to {doc.brand.companyName}.</span>
      </p>
      <p className="mt-2 text-xs text-muted no-print" data-testid="esign-provider-notice">
        {site.name} provides this signing service for {doc.brand.companyName}. {site.name} is not a party to this proposal and does not guarantee the work, the price or the terms in it. Read the <Link href="/esign-disclosure" className="underline" target="_blank">electronic signature disclosure</Link>, our <Link href="/terms" className="underline" target="_blank">Terms</Link> and <Link href="/privacy" className="underline" target="_blank">Privacy Policy</Link>. You can confirm a signed copy hasn&apos;t been changed on our <Link href="/verify" className="underline" target="_blank">document check page</Link>.
      </p>
    </Shell>
  );
}

function Shell({ company, children }: { company?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper print:bg-white">
      <header className="border-b border-line bg-surface no-print">
        <div className="mx-auto flex max-w-[860px] items-center justify-between gap-3 px-4 py-3">
          <span className="truncate font-display font-extrabold text-navy">{company ?? "Proposal"}</span>
          <span className="shrink-0 text-xs text-muted">Secure signing by {site.name}</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[860px] px-4 py-6 sm:py-8 print:max-w-none print:p-0">{children}</main>
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

function Item({ k, v, strong }: { k: string; v?: string; strong?: boolean }) {
  if (!v) return null;
  return <div><dt className="text-muted">{k}</dt><dd className={strong ? "tabular text-lg font-extrabold text-navy" : "font-semibold"}>{v}</dd></div>;
}
