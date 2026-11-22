import { Fragment } from "react";
import Link from "next/link";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { reportProblem } from "@/app/(marketing)/academy/codes/actions";
import { CONTENT_STATUS_LABEL, FEEDBACK_REASONS, KB_DISCLAIMER, REASON_TEXT, citationText, type KbLocalInfo, type KbResult } from "@/lib/academy/kb/types";
import { labelFromId } from "@/lib/academy/kb/geo";
import { stateName } from "@/lib/academy/kb/location";
import { CopyCitation } from "./copy-citation";
import { STATUS, displayStatus, type DisplayStatus } from "@/lib/academy/kb/answer";

const fmtDate = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);
export { fmtDate };

const PUBLIC_STATUS: Record<string, DisplayStatus> = {
  verified_applicable: STATUS.verified, jurisdiction_confirmation_needed: STATUS.local, source_review_needed: STATUS.review,
  not_adopted: STATUS.reference, superseded: STATUS.historical, unavailable: STATUS.reference,
};

export function StatusPill({ s }: { s: DisplayStatus }) {
  return <Badge tone={s.tone}><ShieldCheck className="h-3 w-3" aria-hidden />{s.label}</Badge>;
}

/** One plain status for visitors (the detailed applicability reason is in the note and the admin pages). */
export function ApplicabilityBadge({ a }: { a: KbResult["applicability"] | null | undefined }) {
  if (!a) return null;
  return <StatusPill s={PUBLIC_STATUS[a.status] ?? STATUS.reference} />;
}

export function ApplicabilityNote({ a }: { a: KbResult["applicability"] | null | undefined }) {
  if (!a) return null;
  const meta = PUBLIC_STATUS[a.status] ?? STATUS.reference;
  const reason = a.reason ? REASON_TEXT[a.reason] : null;
  return (
    <p className="text-xs text-ink-soft">
      {meta.help}{reason && reason !== meta.help ? ` ${reason}` : ""}
      {a.scope_note ? ` ${a.scope_note}` : ""}
      {a.other_edition ? ` Enforced edition: ${a.other_edition}.` : ""}
      {a.reason === "local_not_selected" && <> <a href="#project-location" className="font-semibold text-brand hover:underline">Tell us where the project is</a></>}
    </p>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return <p className={`rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted ${className ?? ""}`} data-testid="kb-disclaimer">{KB_DISCLAIMER}</p>;
}

/** The fields every result shows (spec): jurisdiction, trade, source, edition, section, page, effective date, last verified, link. */
export function ResultFacts({ r }: { r: KbResult }) {
  const juris = r.applicability?.jurisdiction_id ?? r.source_jurisdiction;
  const rows: [string, string | null][] = [
    ["Jurisdiction", juris === "US" ? "Federal" : juris ? (juris.includes(":") ? juris : stateName(juris)) : "Model code (applies only where adopted)"],
    ["Source", r.source_title],
    ["Edition", r.edition],
    ["Section", r.citation],
    ["Page", r.page ?? (r.pagination_note ? null : "No page number (online publication)")],
    ["Effective", fmtDate(r.applicability?.effective_date) ?? "Not on file"],
    ["Last verified", fmtDate(r.last_verified_at) ?? "Not verified yet"],
    ["Trades", r.trades.length ? r.trades.join(", ") : "All trades"],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.filter(([, v]) => v).map(([k, v]) => (<Fragment key={k}><dt className="font-semibold text-muted">{k}</dt><dd className="min-w-0 break-words text-ink-soft">{v}</dd></Fragment>))}
      {!r.page && r.pagination_note && (<><dt className="font-semibold text-muted">Page</dt><dd className="text-ink-soft">{r.pagination_note}</dd></>)}
    </dl>
  );
}

export function OfficialLink({ url, label = "Official source" }: { url: string | null | undefined; label?: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
      {label}<ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "verified" ? "ok" : status === "pending_review" ? "warn" : status === "source_unavailable" ? "danger" : "neutral";
  return <Badge tone={tone}>{CONTENT_STATUS_LABEL[status] ?? status}</Badge>;
}

/** A result card: answer text (verified only), applicability, facts, citation, report link. */
export function ResultCard({ r, returnTo, state, strong, staff }: { r: KbResult; returnTo: string; state: string | null; strong?: boolean; staff?: boolean }) {
  const verified = r.section_status === "verified" && r.body_kind !== "title_only";
  const status = displayStatus(r, state);
  return (
    <li className={`rounded-xl border bg-surface p-4 shadow-card ${strong ? "border-ok/40" : "border-line"}`} data-testid="kb-result">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill s={status} />
        {staff && r.section_status !== "verified" && <StatusBadge status={r.section_status} />}
        {r.amend_action && <Badge tone="brand">State amendment</Badge>}
      </div>
      <h3 className="mt-2 font-semibold">
        <Link href={`/academy/codes/section/${r.section_id}${state ? `?state=${state}` : ""}`} className="hover:underline">{r.citation}: {r.title}</Link>
      </h3>
      {verified && r.summary && <p className="mt-1 text-sm text-ink">{r.summary}</p>}
      {!verified && <p className="mt-1 text-sm text-ink-soft">{r.applicability?.status === "not_adopted" ? "A different edition is in force here. Use the official source for the adopted requirement." : "Section title only. Read the requirement in the official source."}</p>}
      {verified && r.exceptions && <p className="mt-1 text-xs text-ink-soft"><span className="font-semibold">Exceptions: </span>{r.exceptions}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold text-muted">Edition and verification details</summary>
        <div className="mb-2"><ApplicabilityNote a={r.applicability} /></div>
        <div className="mt-2"><ResultFacts r={r} /></div>
      </details>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <CopyCitation text={citationText(r)} />
        <OfficialLink url={r.official_url ?? r.read_url} />
        <ReportProblem targetType="section" targetId={r.section_id} returnTo={returnTo} state={state} />
      </div>
    </li>
  );
}

export function ReportProblem({ targetType, targetId, returnTo, state }: { targetType: "section" | "search" | "answer"; targetId: string; returnTo: string; state: string | null }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-semibold text-muted hover:text-ink">Report a problem</summary>
      <form action={reportProblem} className="mt-2 grid max-w-sm gap-2 rounded-lg border border-line bg-paper p-3">
        <input type="hidden" name="target_type" value={targetType} />
        <input type="hidden" name="target_id" value={targetId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="state" value={state ?? ""} />
        <label className="font-semibold">What is wrong?
          <select name="reason" required className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 font-normal">
            {FEEDBACK_REASONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        <label className="font-semibold">Details (optional)
          <textarea name="note" maxLength={1000} rows={2} className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 font-normal" placeholder="Don't include personal information." />
        </label>
        <button type="submit" className="justify-self-start rounded-md bg-navy px-3 py-1.5 font-semibold text-white">Send to reviewers</button>
      </form>
    </details>
  );
}

/** The picked local permitting authority: what the state's official directory says, or what to confirm when not on file. */
export function LocalCard({ id, info, state }: { id: string; info: KbLocalInfo | null; state: string | null }) {
  const name = info?.name ?? labelFromId(id);
  const st = stateName(state) ?? "the state";
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm" data-testid="kb-local-card">
      <h2 className="text-base font-bold">{name}</h2>
      {info?.status === "enforces" && (
        <>
          <p className="mt-1 text-ink-soft">Enforces the {st} State Building Code locally. Permits and inspections go through its building department.</p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            {info.phone && <><dt className="font-semibold">Building department</dt><dd><a className="text-brand hover:underline" href={`tel:${info.phone.replace(/\D/g, "")}`}>{info.phone}</a></dd></>}
            {info.detail?.electrical && <><dt className="font-semibold">Electrical inspections</dt><dd>{info.detail.electrical === "state" ? "State electrical inspector" : "Local electrical inspector"}</dd></>}
            {info.detail?.plumbing_inspects !== undefined && <><dt className="font-semibold">Plumbing inspections</dt><dd>{info.detail.plumbing_inspects ? "Local" : "Not done locally; confirm with the state"}</dd></>}
          </dl>
        </>
      )}
      {info?.status === "not_enforced" && (
        <p className="mt-1 text-ink-soft">Has not adopted the {st} State Building Code for local enforcement, so there may be no local building permit or inspection. The state code is still the standard that applies statewide. Check with {info.county ? `${info.county} County` : "the county"} about zoning, septic and other permits.</p>
      )}
      {(!info || info.status === "unknown") && (
        <p className="mt-1 text-ink-soft">We haven&apos;t verified how {name} handles building permits yet. Contact its building department (or the county for unincorporated areas) to confirm which code edition it enforces and any local amendments.</p>
      )}
      {info?.source_url && (
        <p className="mt-2 text-xs text-muted">
          Source: <a className="text-brand hover:underline" href={info.source_url} target="_blank" rel="noopener noreferrer">official state directory<ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden /></a>
          {info.verified_at ? ` · Last verified ${fmtDate(info.verified_at)}` : ""}
        </p>
      )}
    </section>
  );
}
