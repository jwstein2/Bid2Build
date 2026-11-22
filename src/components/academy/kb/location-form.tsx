"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { AddressInput } from "@/components/ui/address-input";
import { labelFromId, parseShard, shardUrl, type GeoOption } from "@/lib/academy/kb/geo";

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
 * "Where is the project?" A ZIP lists the cities, townships and unincorporated county areas it touches (Census 2020
 * ZIP relationship files, served as static files); the visitor picks one. A ZIP alone never decides the permitting
 * authority. An optional street address lookup (free Census geocoder, through our server) picks it exactly.
 */
export function LocationForm({ action, q, initial, states, trades, note }: Props) {
  const [zip, setZip] = useState(initial.zip ?? "");
  const [state, setState] = useState(initial.state ?? "");
  const [local, setLocal] = useState(initial.local ?? "");
  const [shard, setShard] = useState<{ zip: string; opts: GeoOption[] }>({ zip: "", opts: [] });
  const [extra, setExtra] = useState<GeoOption | null>(null);
  const [address, setAddress] = useState("");
  const latestAddress = useRef("");
  const [addrMsg, setAddrMsg] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const url = shardUrl(zip);
  const loading = Boolean(url) && shard.zip !== zip;
  const base = url && shard.zip === zip ? shard.opts : [];
  const options = extra && !base.some((o) => o.id === extra.id) ? [extra, ...base] : base;

  useEffect(() => {
    if (!url) return;
    let live = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        const opts = parseShard(d, zip);
        setShard({ zip, opts });
        if (opts.length) {
          const st = opts[0].id.slice(0, 2);
          setState(st);
          setLocal((cur) => (cur && opts.some((o) => o.id === cur) ? cur : opts.length === 1 ? opts[0].id : cur.startsWith(`${st}:`) ? cur : ""));
        }
      })
      .catch(() => { if (live) setShard({ zip, opts: [] }); });
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
        setAddrMsg(r.status === 429 ? "Too many lookups for now. Pick from the ZIP list instead." : "We couldn't match that address. Check it, or pick from the ZIP list.");
      }
    } catch {
      setAddrMsg("We couldn't look that up right now. Pick from the ZIP list instead.");
    } finally { setLooking(false); }
  }

  const listed = options.length ? options : local ? [{ id: local, label: labelFromId(local), kind: (local.endsWith("-county") ? "county" : /-(twp|town)$/.test(local) ? "township" : "city") as GeoOption["kind"], share: 1 }] : [];
  const stateMismatch = local && state && !local.startsWith(`${state}:`);

  return (
    <form action={action} id="project-location" className="mt-5 scroll-mt-24 rounded-xl border border-line bg-surface p-4" data-testid="kb-location">
      <input type="hidden" name="return_to" value="/academy/codes" />
      <input type="hidden" name="q" value={q} />
      <input type="hidden" name="local" value={stateMismatch ? "" : local} />
      <h2 className="text-base font-bold">Where is the project?</h2>
      <p className="text-xs text-muted">Codes can change at the city, township or county line. Enter the project&apos;s ZIP code, then pick the area it&apos;s in.</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr_1fr]">
        <label className="text-xs font-semibold text-muted">Project ZIP code
          <input name="zip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="55901" className={`mt-1 ${input}`} data-testid="kb-zip" />
        </label>
        <label className="text-xs font-semibold text-muted">State
          <select name="state" value={state} onChange={(e) => { setState(e.target.value); if (!local.startsWith(`${e.target.value}:`)) setLocal(""); }} className={`mt-1 ${input}`}>
            <option value="">Federal rules only</option>
            {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">Trade
          <select name="trade" defaultValue={initial.trade ?? ""} className={`mt-1 ${input}`}>
            <option value="">All trades</option>
            {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </label>
      </div>

      <fieldset className="mt-3">
        <legend className="text-xs font-semibold text-muted">City, township or county the project is in</legend>
        {loading && <p className="mt-1 text-sm text-ink-soft">Finding areas in {zip}…</p>}
        {!loading && zip.length === 5 && !options.length && !local && <p className="mt-1 text-sm text-ink-soft">We don&apos;t have areas for that ZIP. Try the street address below.</p>}
        {!loading && zip.length < 5 && !local && <p className="mt-1 text-sm text-ink-soft">Enter a ZIP code to see the choices.</p>}
        {listed.length > 0 && (
          <ul className="mt-1 grid gap-1 sm:grid-cols-2" data-testid="kb-local-options">
            {listed.map((o) => (
              <li key={o.id}>
                <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${local === o.id ? "border-brand bg-brand/5" : "border-line"}`}>
                  <input type="radio" name="local_pick" value={o.id} checked={local === o.id} onChange={() => pick(o.id)} />
                  <span className="flex-1">{o.label}</span>
                  <span className="text-xs text-muted">{KIND[o.kind]}</span>
                </label>
              </li>
            ))}
            <li>
              <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${!local ? "border-brand bg-brand/5" : "border-line"}`}>
                <input type="radio" name="local_pick" value="" checked={!local} onChange={() => setLocal("")} />
                <span className="flex-1">Not sure yet</span>
              </label>
            </li>
          </ul>
        )}
        {options.length > 1 && <p className="mt-1 text-xs text-muted">This ZIP crosses more than one area. Pick the one the project address is in.</p>}
      </fieldset>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted">Not sure which one? Look up the street address</summary>
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{note}</p>
        <button type="submit" className="inline-flex items-center justify-center gap-1 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white"><MapPin className="h-4 w-4" aria-hidden />Save location</button>
      </div>
    </form>
  );
}
