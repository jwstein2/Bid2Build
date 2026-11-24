import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { Notice } from "@/components/ui/misc";
import { StatusBadge, fmtDate } from "@/components/academy/kb/parts";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireAcademyStaff, isMissing } from "@/lib/academy/server";
import { kbAccess } from "@/lib/academy/kb/server";
import { FEEDBACK_REASONS } from "@/lib/academy/kb/types";
import { field, label, MetricTile } from "../ui";
import { recordCheck, registerDocument, resolveFeedback, resolveQueue, setKbEnabled } from "./actions";
import { FileDrop } from "@/components/ui/file-drop";

type Health = {
  states_verified: string[]; jurisdictions: { total: number; awaiting: number; partial: number; verified: number };
  sources: Record<string, number> | null; adoptions: Record<string, number> | null; sections: Record<string, number> | null; trades_verified: string[];
  oldest_verification: string | null; unreachable: number; superseded: number; items: { approved: number; needs_review: number; draft: number };
  queue_open: number; feedback_new: number; no_answer_30d: { q: string; state: string | null; trade: string | null; n: number }[];
  top_searches_30d: { q: string; n: number }[]; ai_30d: { calls: number; cost_usd: number };
};
type Queue = { id: string; kind: string; title: string; detail: string | null; target_type: string | null; target_id: string | null; priority: number; status: string; created_at: string; affected: Record<string, unknown> };
type Feedback = { id: string; target_type: string; target_id: string; reason: string; note: string | null; state_code: string | null; status: string; created_at: string };
type Source = { id: string; short_title: string; edition: string; status: string; jurisdiction_id: string | null; official_url: string | null; last_verified_at: string | null; last_checked_at: string | null; rights: string };

const KIND: Record<string, string> = { source_change: "Source change", new_document: "New document", user_feedback: "Reader report", stale_content: "Needs re-check", scheduled_review: "Six-month review", coverage_gap: "Coverage gap" };
const sum = (o: Record<string, number> | null | undefined, k: string) => o?.[k] ?? 0;

export default async function ManageCodes({ searchParams }: PageProps<"/academy/manage/codes">) {
  const sp = await searchParams;
  const s = await requireAcademyStaff(["admin", "instructor"]);
  if (!s) notFound();
  const admin = s.me.role === "admin";
  const access = await kbAccess();
  const flash = <Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} />;
  if (!access.migrated) {
    return <>{flash}<Notice tone="warn" title="The code library isn't set up yet">Apply the knowledge-engine SQL (academy-knowledge) in Supabase, then reload this page. Until then nothing here is visible to anyone.</Notice></>;
  }
  const db = createAdminClient();
  const [health, queue, feedback, sources] = await Promise.all([
    (await createClient()).rpc("academy_kb_health").then((r) => (r.error ? null : (r.data as Health))),
    db.from("academy_kb_review_queue").select("id, kind, title, detail, target_type, target_id, priority, status, created_at, affected").in("status", ["open", "in_review"]).order("priority").order("created_at").limit(50),
    db.from("academy_kb_feedback").select("id, target_type, target_id, reason, note, state_code, status, created_at").in("status", ["new", "reviewing"]).order("created_at", { ascending: false }).limit(50),
    db.from("academy_kb_sources").select("id, short_title, edition, status, jurisdiction_id, official_url, last_verified_at, last_checked_at, rights").order("family_slug").order("short_title").limit(200),
  ]);
  if (queue.error && isMissing(queue.error)) notFound();
  const q = (queue.data ?? []) as Queue[];
  const fb = (feedback.data ?? []) as Feedback[];
  const src = (sources.data ?? []) as Source[];
  const reasonLabel = new Map(FEEDBACK_REASONS.map((r) => [r.key as string, r.label]));

  return (
    <>
      {flash}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
        <div>
          <h2 className="font-bold">Codes area is {access.enabled ? "ON for everyone" : "staff-only"}</h2>
          <p className="text-sm text-ink-soft">{access.enabled ? "Learners see the Codes tab and code search." : "Only Academy staff can see the Codes tab while you review it."} <Link href="/academy/codes" className="text-brand hover:underline">Open code search</Link> · <Link href="/academy/manage/codes/coverage" className="text-brand hover:underline" data-testid="kb-coverage-link">50-state coverage audit</Link></p>
        </div>
        {admin && (
          <form action={setKbEnabled}>
            <input type="hidden" name="on" value={access.enabled ? "0" : "1"} />
            <Submit variant={access.enabled ? "secondary" : "primary"}>{access.enabled ? "Make staff-only" : "Turn on for everyone"}</Submit>
          </form>
        )}
      </section>

      {health && (
        <section className="mt-5">
          <h2 className="text-lg font-bold">Content health</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricTile label="States verified" value={health.states_verified.length} href="#sources" />
            <MetricTile label="Verified sections" value={sum(health.sections, "verified")} href="#sources" />
            <MetricTile label="Sections pending review" value={sum(health.sections, "pending_review")} href="#sources" tone={sum(health.sections, "pending_review") ? "warn" : undefined} />
            <MetricTile label="Open review items" value={health.queue_open} href="#queue" tone={health.queue_open ? "warn" : undefined} />
            <MetricTile label="New reader reports" value={health.feedback_new} href="#feedback" tone={health.feedback_new ? "warn" : undefined} />
            <MetricTile label="Unreachable sources" value={health.unreachable} href="#sources" tone={health.unreachable ? "warn" : undefined} />
          </div>
          <p className="mt-2 text-xs text-muted">
            States verified: {health.states_verified.join(", ") || "none"} · Jurisdictions awaiting verification: {health.jurisdictions.awaiting} of {health.jurisdictions.total} ·
            Oldest source verification: {fmtDate(health.oldest_verification) ?? "n/a"} · Trades with verified sections: {health.trades_verified.length || "all-trade rules only"} ·
            AI explanations (30 days): {health.ai_30d.calls} calls, ${Number(health.ai_30d.cost_usd).toFixed(2)}
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-4 text-sm">
              <h3 className="font-semibold">Searches without a verified answer (30 days)</h3>
              {health.no_answer_30d.length ? <ul className="mt-2 space-y-1 text-xs">{health.no_answer_30d.map((x, i) => <li key={i}><span className="font-semibold">{x.q}</span> <span className="text-muted">{[x.state, x.trade].filter(Boolean).join(" · ")} · {x.n}×</span></li>)}</ul> : <p className="mt-1 text-xs text-muted">None yet.</p>}
              <p className="mt-2 text-[11px] text-muted">Aggregate counts only. No user ids, emails or addresses are stored.</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4 text-sm">
              <h3 className="font-semibold">Top searches (30 days)</h3>
              {health.top_searches_30d.length ? <ul className="mt-2 space-y-1 text-xs">{health.top_searches_30d.map((x, i) => <li key={i}>{x.q} <span className="text-muted">{x.n}×</span></li>)}</ul> : <p className="mt-1 text-xs text-muted">None yet.</p>}
            </div>
          </div>
        </section>
      )}

      <section id="queue" className="mt-6">
        <h2 className="text-lg font-bold">Review queue ({q.length})</h2>
        <p className="text-xs text-muted">Official-source changes, dead links, six-month reviews, reader reports and new documents. Nothing changes on the site until someone acts here.</p>
        {q.length === 0 ? <p className="mt-2 text-sm text-ink-soft">All clear.</p> : (
          <ul className="mt-2 space-y-2">
            {q.map((it) => (
              <li key={it.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-semibold">{KIND[it.kind] ?? it.kind}</span><span className="font-semibold">{it.title}</span><span className="text-xs text-muted">P{it.priority} · {fmtDate(it.created_at)}{typeof it.affected?.reports === "number" ? ` · ${it.affected.reports} reports` : ""}</span></div>
                {it.detail && <p className="mt-1 text-xs text-ink-soft">{it.detail}</p>}
                {it.target_type === "section" && it.target_id && <Link className="text-xs text-brand hover:underline" href={`/academy/codes/section/${it.target_id}`}>Open section</Link>}
                <form action={resolveQueue} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={it.id} />
                  <input name="note" maxLength={2000} placeholder="Resolution note" className="min-w-0 flex-1 rounded-md border border-line-strong px-2 py-1 text-xs" />
                  <select name="status" defaultValue="done" className="rounded-md border border-line-strong px-2 py-1 text-xs">
                    <option value="in_review">In review</option><option value="done">Done</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="deferred">Deferred</option>
                  </select>
                  <Submit size="sm" variant="secondary">Update</Submit>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="feedback" className="mt-6">
        <h2 className="text-lg font-bold">Reader reports ({fb.length})</h2>
        {fb.length === 0 ? <p className="mt-2 text-sm text-ink-soft">No open reports.</p> : (
          <ul className="mt-2 space-y-2">
            {fb.map((f) => (
              <li key={f.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <p><span className="font-semibold">{reasonLabel.get(f.reason) ?? f.reason}</span> <span className="text-xs text-muted">{f.target_type} · {f.state_code ?? "no state"} · {fmtDate(f.created_at)}</span></p>
                {f.target_type === "section" ? <Link className="text-xs text-brand hover:underline" href={`/academy/codes/section/${f.target_id}`}>Open section</Link> : <p className="text-xs text-ink-soft">Search: {f.target_id}</p>}
                {f.note && <p className="mt-1 text-xs text-ink-soft">“{f.note}”</p>}
                <form action={resolveFeedback} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={f.id} />
                  <input name="note" maxLength={2000} placeholder="What you found" className="min-w-0 flex-1 rounded-md border border-line-strong px-2 py-1 text-xs" />
                  <select name="status" defaultValue="resolved" className="rounded-md border border-line-strong px-2 py-1 text-xs"><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select>
                  <Submit size="sm" variant="secondary">Update</Submit>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="sources" className="mt-6">
        <h2 className="text-lg font-bold">Publications ({src.length})</h2>
        <p className="text-xs text-muted">Checked monthly against the official source; every source also gets a six-month review. Only admins can mark something verified, and a verified result needs the official link and quoted evidence.</p>
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
          {src.map((x) => (
            <li key={x.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{x.short_title}</span><span className="text-ink-soft">{x.edition}</span><StatusBadge status={x.status} />
                <span className="text-xs text-muted">{x.jurisdiction_id ?? "model code"} · verified {fmtDate(x.last_verified_at) ?? "never"} · checked {fmtDate(x.last_checked_at) ?? "never"}</span>
                {x.official_url && <a href={x.official_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">official</a>}
              </div>
              {admin && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-semibold text-muted">Record a check</summary>
                  <form action={recordCheck} className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input type="hidden" name="target_type" value="source" /><input type="hidden" name="target_id" value={x.id} />
                    <label className={label}>Result<select name="result" className={field} defaultValue="unchanged"><option value="unchanged">Unchanged</option><option value="verified">Verified</option><option value="changed">Changed</option><option value="unreachable">Unreachable</option><option value="superseded">Superseded</option><option value="rejected">Rejected</option></select></label>
                    <label className={label}>How<select name="method" className={field} defaultValue="official_text"><option value="official_text">Read the official text</option><option value="research">Research with official URL</option><option value="manual_review">Admin review</option><option value="url_check">Link check</option></select></label>
                    <label className={label}>Change type<select name="change_kind" className={field} defaultValue=""><option value="">None</option><option value="new_publication">New publication</option><option value="new_adoption">New adoption</option><option value="local_amendment">Local amendment</option><option value="effective_date_change">Effective date change</option><option value="administrative_correction">Administrative correction</option><option value="superseded_edition">Superseded edition</option><option value="unchanged">Unchanged</option></select></label>
                    <label className={label}>Official link<input name="source_url" type="url" defaultValue={x.official_url ?? ""} className={field} /></label>
                    <label className={`${label} sm:col-span-2`}>Evidence (quote the official text)<textarea name="evidence" rows={2} maxLength={4000} className={field} /></label>
                    <label className={`${label} sm:col-span-2`}>Notes<input name="notes" maxLength={2000} className={field} /></label>
                    <div className="sm:col-span-2"><Submit size="sm">Record</Submit></div>
                  </form>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      {admin && (
        <section className="mt-6">
          <h2 className="text-lg font-bold">Add an official document</h2>
          <p className="text-xs text-muted">Register an official link or upload a PDF that Built2Bid has the right to store (U.S. Government work, state law text, or a written licence). Never upload a purchased or copyrighted codebook. Files are private and are not published or indexed until reviewed.</p>
          <form action={registerDocument} className="mt-2 grid max-w-3xl gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
            <label className={`${label} sm:col-span-2`}>Title<input name="title" required minLength={3} maxLength={200} className={field} /></label>
            <label className={label}>Official link (https)<input name="url" type="url" className={field} /></label>
            <FileDrop className="rounded-lg"><label className={label}>Or a PDF (up to 100 MB)<input name="file" type="file" accept="application/pdf" className={field} /></label></FileDrop>
            <label className={`${label} sm:col-span-2`}>Publication (optional)<select name="source_id" className={field} defaultValue=""><option value="">Not linked yet</option>{src.map((x) => <option key={x.id} value={x.id}>{x.short_title} · {x.edition}</option>)}</select></label>
            <label className={`${label} sm:col-span-2`}>Why we may hold it<textarea name="rights_basis" required minLength={10} maxLength={1000} rows={2} className={field} placeholder="e.g. U.S. Government work (17 U.S.C. 105), or state statute text, or licence #..." /></label>
            <label className={`${label} sm:col-span-2`}>Notes<input name="notes" maxLength={2000} className={field} /></label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="confirm" required /> I confirm Built2Bid has the right to store this document.</label>
            <div className="sm:col-span-2"><Submit>Save document</Submit></div>
          </form>
        </section>
      )}
    </>
  );
}
