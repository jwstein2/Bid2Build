"use client";
import { useRouter } from "next/navigation";
import { Card } from "../ui/misc";
import { LocalTime } from "./local-time";
import { ContractorStatus, ExecutedPdfButton } from "./contractor-status";
import type { AuditRecord } from "@/lib/esign/audit";
import type { ContractorState } from "@/lib/esign/contractor/state";

const EVENT_LABELS: Record<string, string> = {
  requirement_recorded: "Signing link created; contractor-signature requirement recorded",
  contractor_signed_auto: "Contractor signature applied automatically (prior authorization)",
  contractor_signed_interactive: "Contractor signed in person",
  countersign_requested: "Customer signed; contractor countersignature requested",
  fully_executed: "Fully executed",
  auto_apply_skipped: "Automatic application skipped",
};

/** Contractor signature, execution status, countersign action and the signature event history. */
export function ExecutionCard({ estimateId, signatureId, versionId, requestId, execution, state }: {
  estimateId: string; signatureId: string; versionId: string; requestId: string | null; execution: NonNullable<AuditRecord["execution"]>; state: ContractorState;
}) {
  const router = useRouter();
  const k = execution.contractor;
  return (
    <Card className="p-4 sm:p-6" aria-labelledby="exec-h" data-testid="execution-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="exec-h" className="font-display text-lg font-extrabold text-navy">Contractor signature &amp; execution</h2>
        {execution.state === "fully_executed" && <ExecutedPdfButton signatureId={signatureId} compact={false} />}
      </div>
      {k ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <D k="Signed for the contractor by" v={`${k.signerName}${k.signerTitle ? `, ${k.signerTitle}` : ""}`} />
          <D k="Company" v={k.companyName} />
          <D k={k.application === "auto_policy" ? "Applied (system time)" : "Signed"} v={<LocalTime iso={k.appliedAtUtc} />} />
          <D k="How" v={k.howApplied} />
          <D k="Authority" v={k.authority === "company_authorization" ? "Authorized by the company owner" : k.authority === "company_owner" ? "Company owner" : "Business owner"} />
          <D k="Signature on file" v={`Version ${k.credentialVersion}${k.policyRevision ? ` · policy revision ${k.policyRevision}` : ""}`} />
          <D k="Signing order" v={execution.signingOrder.map((x) => (x === "customer" ? "Customer" : "Contractor")).join(" → ")} />
          {k.application === "interactive" && <D k="Signer IP address" v={k.ipAddress ?? "Not recorded"} />}
        </dl>
      ) : (
        <div className="mt-3">
          <ContractorStatus estimateId={estimateId} state={state} pending={false} onChanged={() => router.refresh()}
            signed={{ id: signatureId, request_id: requestId ?? undefined, version_id: versionId, version_number: 0, signed_at: "" }} />
        </div>
      )}
      <details className="mt-4 text-sm" open={execution.events.length <= 6}>
        <summary className="cursor-pointer font-semibold text-navy">Signature history ({execution.events.length})</summary>
        <ol className="mt-2 space-y-1.5" data-testid="signature-history">
          {execution.events.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 text-ink-soft"><span className="tabular text-muted"><LocalTime iso={e.at} /></span><span className="text-ink">{EVENT_LABELS[e.event] ?? e.event}</span></li>
          ))}
        </ol>
      </details>
    </Card>
  );
}

function D({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-muted">{k}</dt><dd className="font-semibold [overflow-wrap:anywhere]">{v}</dd></div>;
}
