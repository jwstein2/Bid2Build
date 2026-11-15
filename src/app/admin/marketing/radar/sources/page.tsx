import { Chip, PageHead, Panel, PanelLink, Table, ago, type Tone } from "@/components/admin/cc";
import { SectionTitle } from "@/components/admin/report";
import { requireAdmin } from "@/lib/admin/server";
import { str } from "@/lib/admin/view";
import { loadRadar } from "@/lib/radar/server";
import { canApiPublish, canAutoDiscover, defaultState, linksAllowed, SOURCES, type Gate } from "@/lib/radar/sources";
import { sourceStateAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sources · Radar" };

const gateChip = (g: Gate, authorized: boolean): { tone: Tone; text: string } =>
  g === "forbidden" ? { tone: "red", text: "Prohibited" } : authorized ? { tone: "green", text: "Authorized" } : { tone: "amber", text: "Needs approval" };
const CADENCE: Record<string, string> = { manual: "Owner review queue", daily: "Daily (when connected)", several_weekly: "Several times a week", weekly: "Weekly" };

export default async function RadarSources({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { db } = await requireAdmin();
  const data = await loadRadar(db);
  const error = str(sp.error), saved = str(sp.saved);
  return (
    <div className="space-y-6">
      <PageHead kicker="Opportunity Radar · Sources" title="Source registry and compliance matrix"
        intro="Platform rules are fixed in code and reviewed in pull requests; this page only records your confirmations. Public content is not automatically scrapable, and nothing here posts or messages anyone."
        right={<PanelLink href="/admin/marketing/radar">Opportunity Radar</PanelLink>} />
      {error && <p role="alert" className="rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-sm text-[var(--cc-red)]">{error}</p>}
      {saved && <p role="status" className="rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-sm text-[var(--cc-green)]">Saved.</p>}
      {!data.installed && <p className="text-sm text-[var(--cc-amber)]">The Radar migration isn&apos;t installed here, so source settings can&apos;t be saved yet.</p>}

      <Panel title="Compliance and API availability">
        <Table head={["Source", "Method", "Auto discovery", "API publishing", "Links", "Cadence", "Status"]} align={["l", "l", "l", "l", "l", "l", "l"]} minWidth={980}>
          {SOURCES.map((s) => {
            const st = data.states.get(s.key) ?? defaultState(s.key);
            const d = gateChip(s.automatedDiscovery, st.discovery_authorized);
            const p = gateChip(s.automatedPublish, st.publish_authorized);
            const auto = canAutoDiscover(s.key, st);
            return (
              <tr key={s.key}>
                <td className="font-sans"><a href={`#${s.key}`} className="font-semibold text-white hover:underline">{s.name}</a></td>
                <td className="font-sans text-xs">{s.method === "official_api" ? "Official API available" : "Manual import only"}</td>
                <td><Chip tone={d.tone}>{d.text}</Chip></td>
                <td><Chip tone={p.tone}>{p.text}</Chip></td>
                <td className="font-sans text-xs">{linksAllowed(s.key, st) ? "Allowed" : "Plain domain only"}</td>
                <td className="font-sans text-xs">{CADENCE[auto.ok ? s.cadence : "manual"]}</td>
                <td className="font-sans text-xs">{!st.enabled ? <Chip tone="muted">Off</Chip> : st.last_error ? <Chip tone="red">Error</Chip> : auto.ok ? <Chip tone="green">Connected</Chip> : <Chip tone="blue">Manual</Chip>}</td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 text-xs text-muted">No automated connector ships in this release, so every source is manual import today. Reviewed {SOURCES[0].reviewedOn}; confirm each platform&apos;s current terms before changing anything.</p>
      </Panel>

      <SectionTitle kicker="Per source" title="Details, rules and your confirmations" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {SOURCES.map((s) => {
          const st = data.states.get(s.key) ?? defaultState(s.key);
          const pub = canApiPublish(s.key, st);
          return (
            <Panel key={s.key} kicker={s.platform} title={s.name} className="scroll-mt-24" action={<Chip tone={s.priority === "high" ? "green" : s.priority === "medium" ? "blue" : "muted"}>{s.priority} priority</Chip>}>
              <div id={s.key} className="space-y-2 text-xs text-ink-soft">
                {s.url && <p><a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--cc-blue)] underline">{s.url}</a></p>}
                <p><span className="text-white">Categories:</span> {s.categories.join(", ")}</p>
                <p><span className="text-white">Permitted discovery:</span> {s.permittedDiscovery.join("; ")}</p>
                <p><span className="text-white">Permitted replies:</span> {s.permittedReplies.join("; ")}</p>
                <p><span className="text-[var(--cc-red)]">Prohibited:</span> {s.prohibited.join("; ")}</p>
                <p><span className="text-white">Policy notes:</span> {s.policyNotes}</p>
                <p><span className="text-white">Owner setup:</span> {s.ownerSetup}</p>
                <p className="flex flex-wrap gap-2">{s.policyLinks.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--cc-blue)] underline">{l.label}</a>)}</p>
                <p><span className="text-white">Last successful check:</span> {st.last_success_at ? ago(st.last_success_at) : "Never (manual source)"} · <span className="text-white">Error:</span> {st.last_error ?? "None"}</p>
                <p><span className="text-white">API publishing:</span> {pub.ok ? "Available" : (pub as { reason: string }).reason}</p>
              </div>
              <form action={sourceStateAction} className="mt-3 grid gap-2 border-t border-[var(--cc-line)] pt-3 text-xs sm:grid-cols-2">
                <input type="hidden" name="source_key" value={s.key} />
                <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={st.enabled} className="h-4 w-4" />Use this source</label>
                <label className="flex items-center gap-2"><span>Links:</span><select name="links" defaultValue={st.links_allowed == null ? "" : st.links_allowed ? "yes" : "no"} className="field field-sm !w-auto"><option value="">Platform default ({s.linksAllowedByDefault ? "allowed" : "not allowed"})</option><option value="yes">Community allows links</option><option value="no">No links</option></select></label>
                <label className={`flex items-center gap-2 ${s.automatedDiscovery === "forbidden" ? "opacity-40" : ""}`}><input type="checkbox" name="discovery_authorized" defaultChecked={st.discovery_authorized} disabled={s.automatedDiscovery === "forbidden"} className="h-4 w-4" />Platform approved automated discovery</label>
                <label className={`flex items-center gap-2 ${s.automatedPublish === "forbidden" ? "opacity-40" : ""}`}><input type="checkbox" name="publish_authorized" defaultChecked={st.publish_authorized} disabled={s.automatedPublish === "forbidden"} className="h-4 w-4" />Platform approved API publishing</label>
                <div className="sm:col-span-2"><button type="submit" disabled={!data.installed} className="cc-mono rounded-md border border-[var(--cc-line-strong)] px-3 py-1.5 text-white disabled:opacity-40">Save</button></div>
              </form>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
