import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileJson } from "lucide-react";
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-ink-soft hover:text-navy"><ArrowLeft className="h-4 w-4" aria-hidden /> Back to your bids</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Badge tone="ok" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Signed</Badge>
          <h1 className="mt-2 text-3xl font-extrabold text-navy">{audit.acceptance.projectTitle || "Signed proposal"}</h1>
          <p className="text-ink-soft">{audit.acceptance.customerName} · Proposal #{audit.acceptance.proposalNumber} · Version {audit.acceptance.versionNumber}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SignedPdfButton signatureId={signatureId} variant="accent" />
          <a href={`/api/signatures/${signatureId}/audit`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-navy hover:bg-black/5"><FileJson className="h-4 w-4" aria-hidden /> Audit record</a>
          <Link href={`/estimates/${audit.estimateId}`} className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-ink-soft hover:bg-black/5">Open bid</Link>
        </div>
      </div>

      {sig?.pdf_status !== "ready" && (
        <p className="rounded-lg bg-warn-tint p-3 text-sm text-warn" role="status">
          The signature is recorded and this bid is Signed. The signed PDF {sig?.pdf_status === "failed" ? "couldn't be created yet" : "is still being prepared"}; Download Signed PDF retries it.
        </p>
      )}

      <Card className="p-4 sm:p-6" aria-labelledby="sig-h">
        <h2 id="sig-h" className="font-display text-lg font-extrabold text-navy">Signature details</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
          <div className="flex min-h-24 items-center justify-center rounded-lg border border-line bg-white p-3">
            {s.method === "drawn" && sig?.signature_image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={sig.signature_image} alt={`Drawn signature of ${s.signerName}`} className="max-h-24 max-w-full object-contain" />
              : <span className="font-serif text-3xl italic">{s.typedSignature ?? s.signerName}</span>}
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
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

      <section aria-label="Signed proposal" className="rounded-xl bg-[#e4eaf1] p-2 sm:p-5">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted">The exact version the customer signed</p>
        <ProposalView doc={doc} />
      </section>
    </div>
  );
}

function D({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>;
}
