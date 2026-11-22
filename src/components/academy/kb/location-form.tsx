"use client";
import { useEffect, useRef, useState } from "react";
import { HelpCircle, MapPin, Search } from "lucide-react";
import { AddressInput } from "@/components/ui/address-input";
import { labelFromId, parseShard, shardUrl, zipStatusFor, type GeoOption, type ZipStatus } from "@/lib/academy/kb/geo";

const input = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";
const KIND: Record<GeoOption["kind"], string> = { city: "City", township: "Township", county: "County" };

type Props = {
  action: (form: FormData) => void | Promise<void>;
  q: string;
  initial: { zip: string | null; state: string | null; local: string | null; trade: string | null };
  states: { code: string; name: string }[];
  trades: { slug: string; name: string }[];
  note: string;
};

/**
 * Compact "Project location" bar: ZIP | State | Trade, then the local jurisdiction when the ZIP has data. A ZIP lists the cities, townships and unincorporated county areas it touches (Census 2020
 * ZIP relationship files, served as static files); the visitor picks one. A ZIP alone never decides the permitting
 * authority. An optional street address lookup (free Census geocoder, through our server) picks it exactly.
 */
export function LocationForm({ action, q, initial, states, trades, note }: Props) {
  const [zip, setZip] = useState(initial.zip ?? "");
  const [state, setState] = useState(initial.state ?? "");
  const [local, setLocal] = useState(initial.local ?? "");
  const [shard, setShard] = useState<{ zip: string; opts: GeoOption[]; status: "ok" | "unknown" | "failed" }>({ zip: "", opts: [], status: "ok" });
  const [extra, setExtra] = useState<GeoOption | null>(null);
  const [address, setAddress] = useState("");
  const latestAddress = useRef("");
  const [addrMsg, setAddrMsg] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const url = shardUrl(zip);
  const loading = Boolean(url) && shard.zip !== zip;
  const base = url && shard.zip === zip ? shard.opts : [];
  const options = extra && !base.some((o) => o.id === extra.id) ? [extra, ...base] : base;
  const zipStatus: ZipStatus = zipStatusFor({ zip, loading, shardStatus: shard.zip === zip ? shard.status : null, options: base, state });
  const zipState = base[0]?.id.slice(0, 2) ?? null;

  // Load the areas a ZIP touches. The ZIP never silently changes a state the visitor chose: it only fills an empty
  // state, and a different state is shown as a mismatch they can resolve.
  useEffect(() => {
    if (!url) return;
    let live = true;
    fetch(url)
      .then(async (r) => {
        if (r.status === 404) return { found: false as const, data: null };
        if (!r.ok) throw new Error(String(r.status));
        return { found: true as const, data: await r.json() };
      })
      .then(({ found, data }) => {
        if (!live) return;
        const opts = found ? parseShard(data, zip) : [];
        setShard({ zip, opts, status: opts.length || (found && data && zip in (data as object)) ? "ok" : "unknown" });
        if (opts.length) {
          const st = opts[0].id.slice(0, 2);
          setState((cur) => cur || st);
          setLocal((cur) => (cur && opts.some((o) => o.id === cur) ? cur : opts.length === 1 ? opts[0].id : cur.startsWith(`${st}:`) ? cur : ""));
        }
      })
      .catch(() => { if (live) setShard({ zip, opts: [], status: "failed" }); });
    return () => { live = false; };
  }, [url, zip]);

  const pick = (id: string) => { setLocal(id); if (id) setState(id.slice(0, 2)); };

  async function lookup(value: string = address) {
    setAddrMsg(null);
    if (value.trim().length < 8) { setAddrMsg("Enter the street address with city and state, or ZIP."); return; }
    setLooking(true);
    try {
      const r = await fetch("/api/academy/locate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: value.slice(0, 200) }) });
      const d = (await r.json().catch(() => null)) as { found?: boolean; zip?: string | null; option?: GeoOption; matched?: string; error?: { message?: string } } | null;
      if (d?.found && d.option) {
        if (d.zip && /^\d{5}$/.test(d.zip)) setZip(d.zip);
        setExtra(d.option);
        pick(d.option.id);
        setAddrMsg(`Matched ${d.matched ?? "the address"}: ${d.option.label}.`);
      } else {
        setAddrMsg(r.status === 429 ? "Too many lookups for now. Pick from the ZIP list instead." : "We couldn't match that address. Check it, or pick the area from the list.");
      }
    } catch {
      setAddrMsg("The address lookup isn't responding right now. Statewide search still works.");
    } finally { setLooking(false); }
  }

  const listed = options.length ? options : local ? [{ id: local, label: labelFromId(local), kind: (local.endsWith("-county") ? "county" : /-(twp|town)$/.test(local) ? "township" : "city") as GeoOption["kind"], share: 1 }] : [];
  const stateMismatch = Boolean(local && state && !local.startsWith(`${state}:`));
  const stateLabel = states.find((s) => s.code === state)?.name ?? null;
  const localLabel = local && !stateMismatch ? listed.find((o) => o.id === local)?.label ?? labelFromId(local) : null;
  const zipStateName = zipState ? states.find((s) => s.code === zipState)?.name ?? zipState : null;

  return (
    <form action={action} id="project-location" className="mt-5 scroll-mt-24 rounded-xl border border-line bg-surface p-3 sm:p-4" data-testid="kb-location">
      <input type="hidden" name="return_to" value="/academy/codes" />
      <input type="hidden" name="q" value={q} />
      <input type="hidden" name="local" value={stateMismatch ? "" : local} />
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Project location</h2>
        <details className="relative text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1 font-semibold text-muted hover:text-ink"><HelpCircle className="h-3.5 w-3.5" aria-hidden />Why we ask</summary>
          <p className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-line bg-surface p-3 font-normal text-ink-soft shadow-xl">Codes are adopted by the state, and cities, townships or counties can enforce or amend them. Pick the state to search statewide codes. Add the ZIP and local area to check local rules. A ZIP alone never decides who issues your permit.</p>
        </details>
      </div>

      <div className="mt-2 grid grid-cols-[6.5rem_1fr] gap-2 sm:grid-cols-[7rem_1fr_1fr_auto]">
        <label className="text-xs font-semibold text-muted">ZIP
          <input name="zip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="55901" aria-describedby="kb-zip-status" className={`mt-1 ${input}`} data-testid="kb-zip" />
        </label>
        <label className="text-xs font-semibold text-muted">State
          <select name="state" value={state} onChange={(e) => { setState(e.target.value); if (!local.startsWith(`${e.target.value}:`)) setLocal(""); }} className={`mt-1 ${input}`} data-testid="kb-state">
            <option value="">Federal rules only</option>
            {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label className="col-span-2 text-xs font-semibold text-muted sm:col-span-1">Trade
          <select name="trade" defaultValue={initial.trade ?? ""} className={`mt-1 ${input}`}>
            <option value="">All trades</option>
            {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </label>
        <button type="submit" className="col-span-2 inline-flex min-h-10 items-center justify-center gap-1 self-end rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white sm:col-span-1"><MapPin className="h-4 w-4" aria-hidden />Save</button>
      </div>

      {listed.length > 0 && !stateMismatch && (
        <label className="mt-2 block text-xs font-semibold text-muted">Local jurisdiction
          <select value={stateMismatch ? "" : local} onChange={(e) => (e.target.value ? pick(e.target.value) : setLocal(""))} className={`mt-1 ${input}`} data-testid="kb-local-select">
            <option value="">{listed.length > 1 ? "Pick the city, township or county the project is in" : "Not confirmed"}</option>
            {listed.map((o) => <option key={o.id} value={o.id}>{o.label} ({KIND[o.kind]})</option>)}
          </select>
        </label>
      )}

      <div id="kb-zip-status" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" role="status" aria-live="polite" data-testid="kb-zip-status">
        <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 font-semibold text-ink-soft" data-testid="kb-location-chip">
          {stateLabel ? (localLabel ? `${localLabel}, ${stateLabel}` : `${stateLabel} selected`) : "Federal rules"}
          {stateLabel && <span className="font-normal text-muted">· {localLabel ? "Local jurisdiction picked" : "Local jurisdiction not confirmed"}</span>}
        </span>
        <ZipMessage status={zipStatus} zip={zip} zipStateName={zipStateName} stateLabel={stateLabel} onUseZipState={() => { if (zipState) { setState(zipState); setLocal(base.length === 1 ? base[0].id : ""); } }} />
        {note && <span className="text-muted">{note}</span>}
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">Refine location by street address</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label htmlFor="kb-address" className="sr-only">Project street address</label>
          <div onKeyDown={(e) => { if (e.key === "Enter") { const picked = e.defaultPrevented; e.preventDefault(); if (!picked) void lookup(); } }}>
            {/* Google address suggestions (same as the rest of the app); picking one looks the area up right away. */}
            <AddressInput id="kb-address" value={address} onChange={(v) => { latestAddress.current = v; setAddress(v.slice(0, 200)); }} onPick={() => void lookup(latestAddress.current)}
              placeholder="123 Main St, Byron, MN 55920" className={input} />
          </div>
          <button type="button" onClick={() => void lookup()} disabled={looking} className="inline-flex items-center justify-center gap-1 rounded-md border border-line-strong px-4 py-2 text-sm font-semibold disabled:opacity-60"><Search className="h-4 w-4" aria-hidden />{looking ? "Looking…" : "Look up"}</button>
        </div>
        <p className="mt-1 text-xs text-muted">Suggestions come from Google, and the address is checked with the U.S. Census Bureau&apos;s free lookup to find the city, township or county. We don&apos;t save it.</p>
        {addrMsg && <p className="mt-1 text-sm text-ink-soft" role="status">{addrMsg}</p>}
      </details>
    </form>
  );
}

function ZipMessage({ status, zip, zipStateName, stateLabel, onUseZipState }: { status: ZipStatus; zip: string; zipStateName: string | null; stateLabel: string | null; onUseZipState: () => void }) {
  if (status === "none" || status === "resolved") return null;
  const text: Record<Exclude<ZipStatus, "none" | "resolved" | "mismatch">, string> = {
    incomplete: "Enter all 5 digits of the ZIP.",
    loading: `Finding areas in ${zip}…`,
    multiple: `ZIP ${zip} crosses more than one area. Pick the one the project is in, or search statewide.`,
    no_local_data: `ZIP ${zip} is valid, but we don't have local areas for it yet. Statewide codes are still available.`,
    unknown: `ZIP ${zip} isn't in the U.S. Census ZIP list. It may be a PO-box-only or unassigned ZIP. You can still search${stateLabel ? ` ${stateLabel}` : ""} statewide, or refine by street address.`,
    failed: "We couldn't load local areas right now. Statewide search still works.",
  };
  if (status === "mismatch") {
    return <span className="text-ink-soft" data-testid="kb-zip-msg">ZIP {zip} is in {zipStateName}, but {stateLabel} is selected. <button type="button" onClick={onUseZipState} className="font-semibold text-brand hover:underline">Use {zipStateName}</button></span>;
  }
  return <span className="text-ink-soft" data-testid="kb-zip-msg">{text[status]}</span>;
}
