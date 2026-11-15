import { Chip, Columns, Gauge, Kpi, PageHead, Panel, StackBar, fmt } from "@/components/admin/cc";
import { loadCommandCenter } from "@/lib/admin/load";
import { locationQuality, series } from "@/lib/admin/metrics";
import { bidState } from "@/lib/geo/address";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data quality" };

export default async function DataQuality() {
  const { p, error } = await loadCommandCenter();
  if (!p) return <Panel title="Report unavailable"><p className="text-sm text-ink-soft">The platform data could not be loaded{error ? `: ${error}` : ""}.</p></Panel>;
  const now = new Date();
  const q = locationQuality(p.estimates);
  const pct = (n: number) => (q.total ? Math.round((n / q.total) * 100) : 0);
  const missingDates = p.estimates.filter((e) => !bidState(e).state).map((e) => e.created_at);
  const locatedDates = p.estimates.filter((e) => bidState(e).state).map((e) => e.created_at);
  const located = series(locatedDates, now, 12, "week");
  const missing = series(missingDates, now, 12, "week");
  const sharing = p.consents.filter((c) => c.share_prices).length;
  const mapsKey = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

  return (
    <div className="space-y-6">
      <PageHead kicker="Data quality" title="Location coverage and data health" intro="How complete the data behind the reports is, and what is still blocking the Market Intelligence pricing views." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Bids with a state" value={q.withState} sub={`${pct(q.withState)}% of ${fmt(q.total)} bids`} />
        <Kpi label="Bids with a ZIP" value={q.withZip} tone="blue" sub={`${pct(q.withZip)}% · entered or read from address`} />
        <Kpi label="Bids missing location" value={q.missing} tone={q.missing ? "amber" : "green"} sub="No ZIP, state, or readable address" />
        <Kpi label="Sharing pricing data" value={sharing} tone="violet" sub="Businesses opted in (Settings → Account)" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel kicker="Coverage" title="Bids with a usable state">
          <Gauge value={pct(q.withState)} label="Located" sub={`${fmt(q.withState)} of ${fmt(q.total)}`} tone="green" />
        </Panel>
        <Panel kicker="Source" title="Where each bid's state came from" className="lg:col-span-2">
          <StackBar segments={[
            { label: "ZIP entered on the bid", value: q.bySource.zip, tone: "green" },
            { label: "State field on the bid", value: q.bySource.state_field, tone: "blue" },
            { label: "Read from the typed address", value: q.bySource.address, tone: "violet" },
            { label: "No location", value: q.missing, tone: "muted" },
          ]} />
          <p className="mt-3 text-xs text-muted">Since this release, saving a bid fills empty ZIP, state and city from the typed project address (for example &ldquo;123 Main St, Austin, TX 78701&rdquo;). It never overwrites what the contractor entered.</p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel kicker="12 weeks" title="Bids with a location"><Columns tone="green" points={located} /></Panel>
        <Panel kicker="12 weeks" title="Bids without a location"><Columns tone="amber" points={missing} /></Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel kicker="Market Intelligence" title="Progress to the 20-business minimum">
          <Gauge value={(sharing / 20) * 100} label={`${sharing} of 20 businesses`} sub="Pricing views stay hidden until 20 businesses share" tone="violet" />
          <p className="mt-3 text-xs text-muted">The 20-business floor is enforced in the database so no single contractor&apos;s prices can be singled out. Sharing is opt-in and off by default.</p>
        </Panel>
        <Panel kicker="Integrations" title="Address suggestions (Google Places)">
          <div className="flex flex-wrap gap-2">
            <Chip tone={mapsKey ? "green" : "red"}>{mapsKey ? "API key configured" : "API key missing"}</Chip>
            <Chip tone="amber">Live lookups not verified from the server</Chip>
          </div>
          <p className="mt-3 text-sm text-ink-soft">To check: open a bid and start typing the project address. A dropdown of suggestions means it works. If none appears, Google is refusing the key: in Google Cloud, enable <span className="text-white">Places API (New)</span> and add it to the key&apos;s API restrictions.</p>
          <p className="mt-2 text-xs text-muted">Bids still get a state without suggestions, because the typed address is read on save.</p>
        </Panel>
      </div>
    </div>
  );
}
