import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { Notice } from "@/components/ui/misc";
import { createClient } from "@/lib/supabase/server";
import { requireAcademyStaff, isMissing } from "@/lib/academy/server";
import { trades } from "@/lib/trades/catalog";
import { CATEGORY_LABEL } from "@/lib/academy/kb/answer";
import { CELL_LABEL, tradeStatus, type CellStatus, type CoverageRunState } from "@/lib/academy/kb/coverage";
import { MetricTile } from "../../ui";
import { runCoverageAudit } from "../actions";

const COLS = ["residential", "building", "electrical", "plumbing", "mechanical", "energy", "fire", "existing", "green"] as const;
const CELL: Record<CellStatus, string> = { searchable: "bg-ok/15 text-ok", reference: "bg-brand-tint text-navy", pending: "bg-paper text-ink-soft", none: "text-muted" };
const SHORT: Record<CellStatus, string> = { searchable: "Search", reference: "Ref", pending: "Review", none: "—" };
const OUT: Record<string, string> = { answer: "Answered", reference: "Statewide reference", no_match: "No match" };

type Run = { id: string; ran_at: string; trigger: string; summary: Record<string, number>; states: CoverageRunState[] };

export default async function CoveragePage({ searchParams }: PageProps<"/academy/manage/codes/coverage">) {
  const sp = await searchParams;
  const s = await requireAcademyStaff(["admin", "instructor"]);
  if (!s) notFound();
  const pick = typeof sp.state === "string" && /^[A-Z]{2}$/.test(sp.state) ? sp.state : "CA";
  const { data, error } = await (await createClient()).from("academy_kb_coverage_runs").select("id, ran_at, trigger, summary, states").order("ran_at", { ascending: false }).limit(1).maybeSingle();
  const run = data as Run | null;
  const flash = <Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} />;
  const runForm = (
    <form action={runCoverageAudit}><Submit>Run audit now</Submit></form>
  );
  if (error && isMissing(error)) return <>{flash}<Notice tone="warn" title="Coverage audit isn't set up yet">Apply the coverage-audit SQL (academy-knowledge/pr4) in Supabase, then reload.</Notice></>;
  if (!run) return <>{flash}<section className="rounded-xl border border-line bg-surface p-4"><h2 className="font-bold">Code coverage audit</h2><p className="mt-1 text-sm text-ink-soft">No audit has run yet. It checks every state and DC: codes on file, which are searchable, local records and six real searches each.</p><div className="mt-3">{runForm}</div></section></>;
  const st = run.states.find((x) => x.state === pick) ?? run.states[0];
  const sm = run.summary;

  return (
    <>
      {flash}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
        <div>
          <h2 className="font-bold">Code coverage audit</h2>
          <p className="text-sm text-ink-soft">Last run {new Date(run.ran_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })} CT ({run.trigger}). Runs monthly on its own; source links are re-checked daily in batches. <Link href="/academy/manage/codes" className="text-brand hover:underline">Back to Codes</Link></p>
        </div>
        {runForm}
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Jurisdictions tested" value={sm.jurisdictions ?? 0} href="#coverage-matrix" />
        <MetricTile label="Verified statewide codes" value={sm.with_verified_statewide ?? 0} href="#coverage-matrix" />
        <MetricTile label="Searchable state text" value={sm.with_searchable_state_text ?? 0} href="#coverage-matrix" />
        <MetricTile label="Official reference only" value={sm.reference_only ?? 0} href="#coverage-matrix" />
        <MetricTile label="With items pending" value={sm.with_pending ?? 0} href="#coverage-matrix" />
        <MetricTile label={`Searches answered (of ${sm.searches ?? 0})`} value={sm.answered ?? 0} href="#coverage-matrix" />
      </section>
      <p className="mt-2 text-xs text-muted">Verified and searchable = official text we can search for that state. Official reference = the adopted edition is verified and linked, but its text is copyrighted (model codes) and not stored. A state on file is not the same as complete local coverage.</p>

      <section id="coverage-matrix" className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[60rem] text-xs">
          <thead className="bg-paper text-left">
            <tr><th className="p-2">State</th>{COLS.map((c) => <th key={c} className="p-2">{CATEGORY_LABEL[c]}</th>)}<th className="p-2">Local records</th><th className="p-2">Searches answered</th><th className="p-2">Pending</th></tr>
          </thead>
          <tbody>
            {run.states.map((x) => (
              <tr key={x.state} className="border-t border-line">
                <td className="p-2 font-semibold"><Link href={`?state=${x.state}`} className="text-brand hover:underline">{x.state}</Link></td>
                {COLS.map((c) => { const v = (x.categories[c]?.status ?? "none") as CellStatus; return <td key={c} className="p-1"><span className={`block rounded px-1.5 py-1 text-center ${CELL[v]}`} title={CELL_LABEL[v]}>{SHORT[v]}</span></td>; })}
                <td className="p-2 text-center">{x.local_records || "—"}</td>
                <td className="p-2 text-center">{x.searches.filter((t) => t.outcome === "answer").length}/{x.searches.length}</td>
                <td className="p-2 text-center">{x.adoptions_pending || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-4">
          <h3 className="font-bold">{st.name}: trades</h3>
          <form className="mt-2"><select name="state" defaultValue={st.state} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm">{run.states.map((x) => <option key={x.state} value={x.state}>{x.name}</option>)}</select> <button className="text-sm font-semibold text-brand">Show</button></form>
          <table className="mt-3 w-full text-xs">
            <thead><tr className="text-left"><th className="py-1">Trade</th><th className="py-1">Status</th></tr></thead>
            <tbody>
              {trades.filter((t) => t.slug !== "other").map((t) => { const v = tradeStatus(t.slug, st.categories); return (
                <tr key={t.slug} className="border-t border-line"><td className="py-1">{t.name}</td><td className="py-1">{v ? <span className={`rounded px-1.5 py-0.5 ${CELL[v]}`}>{CELL_LABEL[v]}</span> : <span className="text-muted">No building-code category (federal safety and licensing only)</span>}</td></tr>
              ); })}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <h3 className="font-bold">{st.name}: test searches</h3>
          <ul className="mt-2 space-y-1 text-xs">
            {st.searches.map((t) => <li key={t.q}><span className="font-semibold">{t.q}</span> · {OUT[t.outcome] ?? t.outcome}{t.citation ? ` (${t.citation})` : ""}</li>)}
          </ul>
          <h3 className="mt-4 font-bold">Codes on file</h3>
          <ul className="mt-2 space-y-1 text-xs">
            {Object.entries(st.categories).flatMap(([c, v]) => v.codes.map((k) => (
              <li key={`${c}-${k.name}-${k.edition}`}><span className="font-semibold">{k.name}</span> {k.edition} · {k.status === "verified" ? "verified" : "pending review"}{k.effective ? ` · effective ${k.effective}` : ""}{k.url && <> · <a href={k.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">official</a></>}</li>
            )))}
          </ul>
        </div>
      </section>
    </>
  );
}
