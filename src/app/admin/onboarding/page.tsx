import { PageHead, Panel, Table } from "@/components/admin/cc";
import { requireAdmin } from "@/lib/admin/server";
import { getTour } from "@/lib/guide/tours";
import { loadReport } from "@/lib/admin/load";
import { biggestDrop, setupFunnel } from "@/lib/admin/setup-funnel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Onboarding & Guide" };

type TourRow = { tourId: string; workspace: string; offered: number; started: number; completed: number; dismissed: number; snoozed: number; people: number };
type Overview = {
  tours: TourRow[];
  exits: { tourId: string; version: number; lastStep: number | null; people: number }[];
  help: { launcherOpened: number; articlesViewed: number; searches: number; aiQuestions: number; practiceStarted: number };
  demo: { entered: number; resets: number };
  firstEstimate: { people: number; medianHours: number | null } | null;
};
const RANGES = [7, 30, 90] as const;
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");
const hours = (h: number | null | undefined) => (h == null ? "–" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} days`);

/**
 * Owner view of onboarding: tour adoption and completion, where people leave a tour, Guide/help use
 * and time to first estimate. Only measured counts (first-party guide events); nothing estimated.
 * Real accounts only in the main tables; demo and practice activity is listed separately.
 */
export default async function OnboardingOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const days = RANGES.find((d) => String(d) === sp.days) ?? 30;
  const { user, db } = await requireAdmin();
  const { data, error } = await db.rpc("admin_guide_overview", { p_caller: user.id, p_days: days });
  const o = (error ? null : data) as Overview | null;
  const real = (o?.tours ?? []).filter((t) => t.workspace === "real");
  const other = (o?.tours ?? []).filter((t) => t.workspace !== "real");
  const title = (id: string) => getTour(id)?.title ?? id;
  // Setup funnel: genuine accounts only (same scope as Product usage), signed up in the chosen window.
  const { r } = await loadReport({}).catch(() => ({ r: null }));
  const funnel = r ? setupFunnel(r.facts, r.now.getTime() - days * 864e5, r.now.getTime()) : null;
  const drop = funnel ? biggestDrop(funnel) : null;

  return (
    <div className="space-y-6">
      <PageHead kicker={`Onboarding · last ${days} days`} title="Are new contractors getting started?"
        intro="Guided tours, the Built2Bid Guide and time to first estimate. Counts come from first-party guide events; internal and test accounts are left out, and Demo/Practice activity is reported separately."
        right={<nav className="flex gap-1 text-xs">{RANGES.map((d) => <a key={d} href={`/admin/onboarding?days=${d}`} aria-current={d === days ? "page" : undefined} className={`rounded-md border px-2 py-1 ${d === days ? "border-[var(--cc-green)] text-[var(--cc-green)]" : "border-[var(--cc-line)] text-[#b9cbd6]"}`}>{d} days</a>)}</nav>} />
      <Panel kicker={`Genuine accounts that signed up in the last ${days} days`} title="Setup funnel: where new contractors stop">
        {funnel && funnel[0].count > 0 ? (
          <>
            <div className="space-y-2" data-testid="setup-funnel">
              {funnel.map((f) => (
                <div key={f.key} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate">{f.label}</span>
                  <span className="h-3 overflow-hidden rounded-full bg-[var(--cc-line)]" aria-hidden><span className="block h-full rounded-full bg-[var(--cc-green)]" style={{ width: `${Math.round((f.fromStart ?? 0) * 100)}%` }} /></span>
                  <span className="cc-mono w-28 text-right text-white">{f.count}<span className="ml-2 text-xs text-[#8fa6b4]">{f.fromPrev === null ? "" : pct(f.count, funnel[funnel.indexOf(f) - 1].count)}</span></span>
                </div>
              ))}
            </div>
            {drop && drop.fromPrev !== null && drop.fromPrev < 1 && <p className="mt-3 text-sm">Biggest drop: <b>{drop.label}</b>. Only {pct(drop.count, funnel[funnel.indexOf(drop) - 1].count)} of the accounts at the step before got there.</p>}
            <p className="mt-2 text-[11px] text-[#8fa6b4]">Each step counts accounts that reached it at any time so far. Percent beside each count is of the step above. Test, internal and demo accounts are left out.</p>
          </>
        ) : <p className="text-sm text-[#8fa6b4]">{funnel ? "No genuine sign-ups in this period yet." : "The account report couldn't be read."}</p>}
      </Panel>
      {!o && <Panel title="Report unavailable"><p className="text-sm">The onboarding report couldn&apos;t be read. If the Demo Mode &amp; Guide SQL (20270102001000) hasn&apos;t been run yet, run it first.</p></Panel>}
      {o && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Time to first estimate (median)", hours(o.firstEstimate?.medianHours), `${o.firstEstimate?.people ?? 0} new accounts started a bid`],
              ["Guide opened", String(o.help.launcherOpened), "Times the bottom-left Guide was opened"],
              ["Help searches", String(o.help.searches), `${o.help.articlesViewed} help results opened`],
              ["Ask Built2Bid questions", String(o.help.aiQuestions), "Optional AI help (off unless turned on)"],
            ].map(([label, value, sub]) => (
              <Panel key={label} kicker={label}><p className="cc-mono text-2xl text-white">{value}</p><p className="mt-1 text-xs text-[#8fa6b4]">{sub}</p></Panel>
            ))}
          </div>
          <Panel kicker="Real accounts" title="Tour adoption and completion">
            {real.length ? (
              <Table head={["Tour", "Offered", "Started", "Completed", "Skipped", "Later", "People", "Completion"]} align={["l", "r", "r", "r", "r", "r", "r", "r"]}>
                {real.map((t) => <tr key={t.tourId}><td>{title(t.tourId)}</td><td className="text-right">{t.offered}</td><td className="text-right">{t.started}</td><td className="text-right">{t.completed}</td><td className="text-right">{t.dismissed}</td><td className="text-right">{t.snoozed}</td><td className="text-right">{t.people}</td><td className="text-right">{pct(t.completed, t.started)}</td></tr>)}
              </Table>
            ) : <p className="text-sm text-[#8fa6b4]">No tour activity in this period yet.</p>}
          </Panel>
          <Panel kicker="Real accounts" title="Where people leave a tour">
            {o.exits.length ? (
              <Table head={["Tour", "Left at step", "People"]} align={["l", "r", "r"]} minWidth={360}>
                {o.exits.map((e) => <tr key={`${e.tourId}:${e.version}:${e.lastStep}`}><td>{title(e.tourId)}{e.version > 1 ? ` (v${e.version})` : ""}</td><td className="text-right">{e.lastStep == null ? "Before starting" : e.lastStep + 1}</td><td className="text-right">{e.people}</td></tr>)}
              </Table>
            ) : <p className="text-sm text-[#8fa6b4]">Nobody has left a tour part-way in this period.</p>}
          </Panel>
          <Panel kicker="Kept separate" title="Demo and Practice Mode">
            <p className="text-sm">Demo sessions entered: <b className="cc-mono">{o.demo.entered}</b> · Demo resets: <b className="cc-mono">{o.demo.resets}</b> · Practice sessions started: <b className="cc-mono">{o.help.practiceStarted}</b></p>
            {other.length > 0 && (
              <div className="mt-3"><Table head={["Tour", "Workspace", "Started", "Completed"]} align={["l", "l", "r", "r"]} minWidth={360}>
                {other.map((t) => <tr key={`${t.tourId}:${t.workspace}`}><td>{title(t.tourId)}</td><td>{t.workspace}</td><td className="text-right">{t.started}</td><td className="text-right">{t.completed}</td></tr>)}
              </Table></div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
