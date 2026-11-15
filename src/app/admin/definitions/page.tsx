import { PageHead, Panel } from "@/components/admin/cc";
import { CHANNELS } from "@/lib/admin/channels";
import { METRICS } from "@/lib/admin/definitions";
import { SEGMENTS } from "@/lib/admin/model";
import { requireAdmin } from "@/lib/admin/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Metric definitions" };

export default async function Definitions() {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <PageHead kicker="Metric governance" title="Metric definitions" intro="Every owner report uses these definitions, computed in one place, so a number means the same thing on every page. “Not connected” means there is no source; 0 means the source reports zero." />
      <div className="grid gap-4 lg:grid-cols-2">
        {METRICS.map((m) => (
          <Panel key={m.key} title={m.name}>
            <p className="text-sm text-ink-soft">{m.definition}</p>
            <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Source</dt><dd className="text-ink-soft">{m.source}</dd>
              <dt className="text-muted">Rules</dt><dd className="text-ink-soft">{m.rules}</dd>
              <dt className="text-muted">Window</dt><dd className="text-ink-soft">{m.window}</dd>
              <dt className="text-muted">Refresh</dt><dd className="text-ink-soft">{m.refresh}</dd>
              {m.limits && <><dt className="text-muted">Limitations</dt><dd className="text-ink-soft">{m.limits}</dd></>}
            </dl>
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Customer lifecycle segments"><ul className="space-y-1.5 text-sm">{SEGMENTS.map((s) => <li key={s.key}><span className="font-semibold text-white">{s.label}:</span> <span className="text-ink-soft">{s.def}</span></li>)}</ul></Panel>
        <Panel title="Acquisition channel rules"><ul className="space-y-1.5 text-sm">{CHANNELS.map((c) => <li key={c.key}><span className="font-semibold text-white">{c.label}:</span> <span className="text-ink-soft">{c.rule}</span></li>)}</ul></Panel>
      </div>
    </div>
  );
}
