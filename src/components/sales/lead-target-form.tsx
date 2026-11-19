import { TRADES } from "@/lib/sales/crm";
import { saveLeadTargetForm } from "@/lib/sales/lead-target-actions";

/** The weekly import target as sales_import_target() returns it. */
export interface LeadTarget {
  mode?: "zip" | "region"; zip: string | null; trade: string | null; radius_miles: number; count: number; paused: boolean;
  state?: string | null; region?: { state: string; slug: string; name: string; counties: string[]; zips: string[] } | null;
  resume?: { cursor: string | null; checked: number; added: number; runs: number; exhausted: boolean; updated_at: string | null };
}
/** States with a free license download and their regions (admin_sales_lead_regions). */
export interface LeadRegionState { state: string; state_name: string; source: string; url: string; regions: { slug: string; name: string; counties: string[]; zip_count: number }[] }

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

function summary(t: LeadTarget): string {
  const trade = t.trade ? `, ${t.trade}` : "";
  const paused = t.paused ? " (paused)" : "";
  if (t.mode === "region") return t.region ? `${t.count} leads in ${t.region.name}${trade}${paused}` : "pick a region, so the weekly run is waiting";
  return t.zip ? `${t.count} leads within ${t.radius_miles} miles of ${t.zip}${trade}${paused}` : "not set yet, so the weekly run is waiting";
}

function progressLine(t: LeadTarget): string | null {
  const r = t.resume;
  if (!r || !r.runs) return t.mode === "region" && t.region ? "The first run starts at the top of the license list." : null;
  const done = `${r.checked.toLocaleString()} businesses checked, ${r.added} added over ${r.runs} run${r.runs === 1 ? "" : "s"}`;
  return r.exhausted ? `Finished this list (${done}). Pick another region or tick "Start over".` : `${done}. The next run picks up after ${r.cursor}.`;
}

/**
 * Sales Hub → Leads: where the weekly Claude agent looks next. A state region (fixed county list, worked
 * through the state's free license download, resuming where the last run stopped) or a ZIP + radius.
 * Plain form, no client script: the server reads only the fields for the chosen mode.
 */
export function LeadTargetForm({ target, states, zips, back }: { target: LeadTarget; states: LeadRegionState[]; zips: { zip: string; leads: number }[]; back: string }) {
  const mode = target.mode === "region" || (!target.zip && states.length > 0) ? "region" : "zip";
  const current = target.region ? `${target.region.state}:${target.region.slug}` : "";
  const progress = progressLine(target);
  return (
    <form action={saveLeadTargetForm} className="mt-4 grid gap-3 rounded-lg border border-line bg-paper p-3">
      <input type="hidden" name="back" value={back} />
      <p className="text-sm font-semibold">Next run target: {summary(target)}</p>
      {progress && <p className="-mt-2 text-xs text-muted">{progress}</p>}
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <legend className="sr-only">Search by</legend>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="mode" value="region" defaultChecked={mode === "region"} disabled={!states.length} /> By state region</label>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="mode" value="zip" defaultChecked={mode === "zip"} /> By ZIP + radius</label>
      </fieldset>
      {states.length > 0 && (
        <div className="grid gap-3 rounded-lg border border-line bg-white p-3 sm:grid-cols-[2fr_auto] sm:items-end">
          <label className="text-sm">State region
            <select name="region" defaultValue={current} className={input}>
              <option value="">Choose a region</option>
              {states.map((s) => (
                <optgroup key={s.state} label={s.state_name}>
                  {s.regions.map((r) => <option key={r.slug} value={`${s.state}:${r.slug}`}>{`${r.name} (${r.counties.length} counties)`}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="restart" /> Start over from the top</label>
          {target.region && <p className="text-xs text-muted sm:col-span-2">Counties: {target.region.counties.join(", ")}.</p>}
          <p className="text-xs text-muted sm:col-span-2">Regions exist where the state publishes a free contractor license list ({states.map((s) => s.state_name).join(", ")}). Wisconsin sells its list, and South and North Dakota don&apos;t publish one, so use ZIP + radius there.</p>
        </div>
      )}
      <div className="grid gap-3 rounded-lg border border-line bg-white p-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="text-sm">ZIP code
          <input name="zip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} list="lead-target-zips" defaultValue={target.zip ?? ""} className={input} placeholder="55401" />
          <datalist id="lead-target-zips">{zips.map((z) => <option key={z.zip} value={z.zip}>{`${z.leads} lead${z.leads === 1 ? "" : "s"}`}</option>)}</datalist>
        </label>
        <label className="text-sm">Miles<input name="radius" type="number" min={5} max={250} defaultValue={target.radius_miles} className={`${input} w-24`} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="text-sm">Trade
          <select name="trade" defaultValue={target.trade ?? ""} className={input}>
            <option value="">All trades</option>
            {TRADES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
          </select>
        </label>
        <label className="text-sm">Leads per run<input name="count" type="number" min={1} max={200} defaultValue={target.count} className={`${input} w-24`} /></label>
        <button className={btn}>Save target</button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="paused" defaultChecked={target.paused && !!(target.zip || target.region)} /> Pause the weekly run</label>
    </form>
  );
}
