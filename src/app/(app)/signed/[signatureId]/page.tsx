import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { notFound } from "next/navigation";
import { CalendarRange, CheckCircle2, FileJson } from "lucide-react";
import { isFinancialsEnabled, isPmEnabled } from "@/lib/env";
import { stepsAfterSigning } from "@/lib/guide/next-steps";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isEsignEnabled } from "@/lib/esign/config";
import { auditRecord } from "@/lib/esign/audit";
import { loadLogo } from "@/lib/esign/server";
import { ProposalView } from "@/components/proposal/proposal-view";
import { Badge, Card } from "@/components/ui/misc";
import { formatCurrency } from "@/lib/estimate/money";
import type { ProposalDocument } from "@/lib/proposal/types";
import { LocalTime } from "@/components/esign/local-time";
import { SignedPdfButton } from "@/components/esign/signed-pdf-button";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { viewSignature, type ContractorSignature } from "@/lib/esign/contractor/server";
import { contractorState } from "@/lib/esign/contractor/state";
import { ExecutionCard } from "@/components/esign/execution-card";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Signed proposal", robots: { index: false } };

/**
 * View Signed Proposal + signature details. Visibility comes from RLS on signatures (the bid's owner,
 * plus Enterprise members allowed to view the bid); the frozen proposal is then read server-side.
 */
export default async function SignedProposalPage({ params }: PageProps<"/signed/[signatureId]">) {
  if (!isEsignEnabled()) notFound();
  const { signatureId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(signatureId)) notFound();
  const supabase = await createClient();
  const audit = await auditRecord(supabase, signatureId);
  if (!audit) notFound();
  const admin = createAdminClient();
  const [{ data: v }, { data: sig }] = await Promise.all([
    admin.from("estimate_versions").select("proposal, snapshot->business->>logoPath").eq("id", audit.versionId).maybeSingle(),
    admin.from("signatures").select("signature_image, pdf_status").eq("id", signatureId).maybeSingle(),
  ]);
  if (!v) notFound();
  const row = v as unknown as { proposal: ProposalDocument; logoPath?: string | null };
  const logo = await loadLogo(admin, row.logoPath ?? null);
  const doc = { ...row.proposal, brand: { ...row.proposal.brand, logoUrl: logo ? `data:image/png;base64,${logo.data.toString("base64")}` : null } };
  const s = audit.signature;
  // V5.3: contractor side, read through the viewer's RLS (plus the authority check for countersigning).
  const contractorOn = isContractorSigningEnabled();
  const user = contractorOn ? await getUser() : null;
  const cstate = contractorOn && user ? await contractorState(supabase, admin, user.id, audit.estimateId) : null;
  const k = contractorOn ? ((await supabase.from("contractor_signatures").select("*").eq("version_id", audit.versionId).maybeSingle()).data as ContractorSignature | null) : null;
  const execution = audit.execution;
  const next = stepsAfterSigning({ estimateId: audit.estimateId, awaitingContractor: execution?.state === "awaiting_contractor", scheduling: isPmEnabled(), financials: isFinancialsEnabled() });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Breadcrumbs items={[{ label: "Signed proposal" }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge tone="ok" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Signed by customer</Badge>
            {execution && <Badge tone={execution.state === "fully_executed" ? "ok" : execution.state === "awaiting_contractor" ? "warn" : "neutral"} className="gap-1" data-testid="execution-state">{execution.label}</Badge>}
          </div>
          <h1 className="mt-2 text-3xl font-extrabold text-navy">{audit.acceptance.projectTitle || "Signed proposal"}</h1>
          <p className="text-ink-soft">{audit.acceptance.customerName} · Proposal #{audit.acceptance.proposalNumber} · Version {audit.acceptance.versionNumber}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SignedPdfButton signatureId={signatureId} variant="accent" />
          <a href={`/api/signatures/${signatureId}/audit`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-navy hover:bg-black/5"><FileJson className="h-4 w-4" aria-hidden /> Audit record</a>
          {isPmEnabled() && <Link href={`/projects/new?estimate=${audit.estimateId}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-navy hover:bg-black/5" data-testid="schedule-now"><CalendarRange className="h-4 w-4" aria-hidden /> Schedule Now</Link>}
          <Link href={`/estimates/${audit.estimateId}`} className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-ink-soft hover:bg-black/5">Open bid</Link>
        </div>
      </div>

      {next.length > 0 && (
        <Card className="p-4 sm:p-5" aria-labelledby="next-h" data-testid="whats-next">
          <h2 id="next-h" className="font-display text-lg font-extrabold text-navy">What&apos;s next</h2>
          <p className="text-sm text-ink-soft">The job is yours. Here&apos;s how to take it from signed to scheduled and paid.</p>
          <ol className="mt-3 grid gap-2 md:grid-cols-2">
            {next.map((n, i) => (
              <li key={n.id} className={`flex gap-3 rounded-xl border p-3 ${i === 0 ? "border-accent bg-accent-tint/40" : "border-line"}`} data-testid={`next-${n.id}`}>
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-strong text-xs font-bold text-muted" aria-hidden>{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-semibold">{n.title}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">{n.why}</p>
                  <Link href={n.href} className={`mt-2 inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold ${i === 0 ? "bg-accent text-navy hover:bg-accent-hover" : "border border-line-strong hover:bg-black/5"}`}>{n.label}</Link>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {sig?.pdf_status !== "ready" && (
        <p className="rounded-lg bg-warn-tint p-3 text-sm text-warn" role="status">
          The signature is recorded and this bid is Signed. The signed PDF {sig?.pdf_status === "failed" ? "couldn't be created yet" : "is still being prepared"}; Download Signed PDF retries it.
        </p>
      )}

      <Card className="p-4 sm:p-6" aria-labelledby="sig-h">
        <h2 id="sig-h" className="font-display text-lg font-extrabold text-navy">{execution ? "Customer signature" : "Signature details"}</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          <div className="theme-light flex min-h-24 items-center justify-center rounded-lg border border-line bg-white p-3 text-ink">
            {s.method === "drawn" && sig?.signature_image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={sig.signature_image} alt={`Drawn signature of ${s.signerName}`} className="max-h-24 max-w-full object-contain" />
              : <span className="font-serif text-3xl italic">{s.typedSignature ?? s.signerName}</span>}
          </div>
          <dl className="grid min-w-0 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <D k="Signer" v={s.signerName} />
            <D k="Signer email" v={s.signerEmail} />
            <D k="Signed" v={<LocalTime iso={s.signedAtUtc} />} />
            <D k="Accepted total" v={formatCurrency(audit.acceptance.total)} />
            <D k="Method" v={s.method === "drawn" ? "Drawn signature" : "Typed signature"} />
            <D k="Verification" v={s.verification === "email_code" ? "Email code confirmed" : "Private link only (identity not independently verified)"} />
            <D k="Consent version" v={audit.consent.version} />
            <D k="IP address" v={audit.evidence.ipAddress ?? "Not recorded"} />
          </dl>
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold text-navy">Consent, acceptance and document hashes</summary>
          <div className="mt-2 space-y-2 text-ink-soft">
            <p><span className="font-semibold text-ink">Consent: </span>{audit.consent.text}</p>
            <p><span className="font-semibold text-ink">Acceptance: </span>{audit.acceptance.text}</p>
            <p className="break-all"><span className="font-semibold text-ink">Proposal PDF SHA-256: </span><code>{audit.document.proposalPdfSha256}</code></p>
            {audit.document.signedPdfSha256 && <p className="break-all"><span className="font-semibold text-ink">Signed PDF SHA-256: </span><code>{audit.document.signedPdfSha256}</code></p>}
          </div>
        </details>
      </Card>

      {execution && cstate && (
        <div id="execution" className="scroll-mt-20">
        <ExecutionCard estimateId={audit.estimateId} signatureId={signatureId} versionId={audit.versionId} requestId={audit.request?.id ?? null} execution={execution} state={cstate} />
        </div>
      )}

      <section aria-label="Signed proposal" className="theme-light min-w-0 overflow-x-auto rounded-xl bg-[#e4eaf1] p-2 sm:p-5">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted">The exact version the customer signed</p>
        <ProposalView doc={doc}
          customerSignature={contractorOn ? { name: s.signerName, date: s.signedAtUtc.slice(0, 10), image: s.method === "drawn" ? sig?.signature_image ?? null : null, typed: s.method === "typed" ? s.typedSignature : null } : null}
          contractorSignature={k ? viewSignature(k) : null} />
      </section>
    </div>
  );
}

function D({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-muted">{k}</dt><dd className="font-semibold [overflow-wrap:anywhere]">{v}</dd></div>;
}
