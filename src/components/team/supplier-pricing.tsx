"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, FileSpreadsheet, MapPin, PlugZap, Scale, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import {
  branchSearchUrl, connectionStatusLabel, crossCheckGroups, mapCrossCheck, OFFER_LABELS, PRICING_PROVIDERS,
  type ConnectionList, type CrossCheckRow, type PricingProvider, type SupplierConnection,
} from "@/lib/pricing/providers";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const KIND_LABEL = { supplier: "Supplier", market_data: "Market price data", retail: "Retail store" } as const;

type SupplierOption = { id: string; name: string };

/** Supplier pricing: compare imported price lists, find branches, and opt in to supplier connections. */
export function SupplierPricing({ connections, suppliers }: { connections: ConnectionList | null; suppliers: SupplierOption[] }) {
  return (
    <div className="space-y-8" data-testid="supplier-pricing">
      <CrossCheck />
      <BranchFinder suppliers={suppliers} />
      <Connections list={connections} suppliers={suppliers} />
    </div>
  );
}

function CrossCheck() {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "done"; rows: CrossCheckRow[] }>({ status: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    api<unknown>(`/api/team/supplier-pricing/cross-check${asked ? `?q=${encodeURIComponent(asked)}` : ""}`).then((r) => {
      if (!live) return;
      setState(r.ok ? { status: "done", rows: mapCrossCheck(r.data).rows } : { status: "error", message: r.message });
    });
    return () => { live = false; };
  }, [asked, reload]);

  const groups = state.status === "done" ? crossCheckGroups(state.rows) : [];
  function submit(e: React.FormEvent) { e.preventDefault(); setState({ status: "loading" }); setAsked(q.trim()); setReload((n) => n + 1); }

  return (
    <section aria-labelledby="xc-h" className="space-y-3" data-testid="cross-check">
      <div>
        <h2 id="xc-h" className="flex items-center gap-2 text-xl font-bold text-navy"><Scale className="h-5 w-5" aria-hidden /> Price cross-check</h2>
        <p className="text-sm text-ink-soft">Compares the latest price each supplier gave you for the same product, from the price lists you imported. Only real prices from your lists, with the date they took effect.</p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap gap-2" role="search">
        <label className="relative min-w-0 flex-1 basis-56"><span className="sr-only">Search a product or SKU</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field h-10 pl-9" placeholder="Search a product or SKU, e.g. OSB 7/16" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} data-testid="cross-check-q" /></label>
        <Button size="sm" variant="accent" className="min-h-10" type="submit">Compare</Button>
        {asked && <Button size="sm" variant="secondary" className="min-h-10" type="button" onClick={() => { setQ(""); setState({ status: "loading" }); setAsked(""); setReload((n) => n + 1); }}>Show all overlaps</Button>}
      </form>

      {state.status === "loading" && <p className="text-sm text-muted" role="status">Loading prices…</p>}
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}
      {state.status === "done" && groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted" data-testid="cross-check-empty">
          {asked ? <>No imported prices match &ldquo;{asked}&rdquo;.</> : <>No product is priced by two or more of your suppliers yet. Import a price list from each supplier and matching products show up here side by side.</>}
          <div className="mt-3"><Link href="/dashboard/items/import" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-paper"><FileSpreadsheet className="h-4 w-4" aria-hidden /> Import a price list</Link></div>
        </div>
      )}
      {groups.length > 0 && (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.key} className="rounded-xl border border-line bg-surface p-4" data-testid="cross-check-group">
              <p className="font-semibold text-navy">{g.product} <span className="text-sm font-normal text-ink-soft">per {g.unit}{g.packSize && g.packSize !== 1 ? ` (pack of ${g.packSize})` : ""}</span></p>
              {g.spread !== null && g.spread > 0 && <p className="text-xs text-ink-soft">Spread between suppliers: {money(g.spread)}</p>}
              <div className="relative mt-2 overflow-x-auto">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-3 font-semibold">Supplier</th><th className="py-1 pr-3 font-semibold">SKU</th><th className="py-1 pr-3 text-right font-semibold">Price</th><th className="py-1 pr-3 font-semibold">Effective</th><th className="py-1 font-semibold"><span className="sr-only">Compared</span></th></tr></thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={`${r.supplier}|${r.sku ?? ""}`} className="border-t border-line">
                        <td className="py-1.5 pr-3 font-medium">{r.supplier}</td>
                        <td className="py-1.5 pr-3 text-ink-soft">{r.sku ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.unitCost)}</td>
                        <td className="py-1.5 pr-3 text-ink-soft">{day(r.effectiveOn)}</td>
                        <td className="py-1.5">{r.expired ? <Badge tone="warn">Expired {day(r.expiresOn)}</Badge> : r.lowest ? <Badge tone="ok">Lowest</Badge> : r.overLowest ? <span className="text-xs text-ink-soft">+{money(r.overLowest)}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BranchFinder({ suppliers }: { suppliers: SupplierOption[] }) {
  const [near, setNear] = useState("");
  const names = [...new Set([...suppliers.map((s) => s.name), ...PRICING_PROVIDERS.flatMap((p) => (p.branchSearch ? [p.branchSearch] : []))])];
  return (
    <section aria-labelledby="bf-h" className="space-y-3" data-testid="branch-finder">
      <div>
        <h2 id="bf-h" className="flex items-center gap-2 text-xl font-bold text-navy"><MapPin className="h-5 w-5" aria-hidden /> Find a branch</h2>
        <p className="text-sm text-ink-soft">Enter a job&apos;s ZIP code or town, then open a map of nearby branches for any supplier.</p>
      </div>
      <label className="block max-w-xs"><span className="text-sm font-semibold">Near (ZIP or town)</span>
        <input className="field mt-1 h-10" inputMode="text" maxLength={60} placeholder="e.g. 55401" value={near} onChange={(e) => setNear(e.target.value)} data-testid="branch-near" /></label>
      <ul className="flex flex-wrap gap-2">
        {names.map((n) => (
          <li key={n}><a href={branchSearchUrl(n, near)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-paper">
            {n} <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">(opens a map in a new tab)</span></a></li>
        ))}
      </ul>
    </section>
  );
}

function Connections({ list, suppliers }: { list: ConnectionList | null; suppliers: SupplierOption[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!list) return <Notice tone="warn" title="Supplier connections are being set up">The database update for this section hasn&apos;t been applied yet.</Notice>;
  const byId = new Map(list.connections.map((c) => [c.provider, c]));
  return (
    <section aria-labelledby="sc-h" className="space-y-3" data-testid="connections">
      <div>
        <h2 id="sc-h" className="flex items-center gap-2 text-xl font-bold text-navy"><PlugZap className="h-5 w-5" aria-hidden /> Supplier connections</h2>
        <p className="text-sm text-ink-soft">Optional. Choose which suppliers and price sources may feed your cross-check. Each one goes live only after that supplier approves Built2Bid&apos;s access; until then we save your request and account number, never a password.</p>
      </div>
      {!list.canManage && <Notice>Ask your company admin to connect a supplier.</Notice>}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <ul className="grid gap-3 md:grid-cols-2">
        {PRICING_PROVIDERS.map((p) => <ProviderCard key={p.id} provider={p} conn={byId.get(p.id)} canManage={list.canManage} suppliers={suppliers} onMsg={setMsg} />)}
      </ul>
    </section>
  );
}

function ProviderCard({ provider: p, conn, canManage, suppliers, onMsg }: { provider: PricingProvider; conn?: SupplierConnection; canManage: boolean; suppliers: SupplierOption[]; onMsg: (m: { ok: boolean; text: string }) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const tone = conn?.status === "connected" ? "ok" : conn?.status === "paused" ? "warn" : conn ? "brand" : "neutral";

  async function send(method: "POST" | "DELETE", body?: object, done?: string) {
    setBusy(true);
    const r = await api(method === "DELETE" ? `/api/team/supplier-pricing/connections?provider=${p.id}` : "/api/team/supplier-pricing/connections", { method, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    onMsg(r.ok ? { ok: true, text: done ?? "Saved." } : { ok: false, text: r.message });
    if (r.ok) { setEditing(false); router.refresh(); }
  }

  return (
    <li className="flex flex-col rounded-xl border border-line bg-surface p-4" data-testid="provider-card" data-provider={p.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-navy">{p.name}</p>
          <p className="text-xs text-muted">{KIND_LABEL[p.kind]} · {p.trades.join(", ")}</p>
        </div>
        <Badge tone={tone}>{connectionStatusLabel(conn)}</Badge>
      </div>
      <p className="mt-2 flex flex-wrap gap-1">{p.offers.map((o) => <span key={o} className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-ink-soft">{OFFER_LABELS[o]}</span>)}</p>
      <p className="mt-2 text-sm text-ink-soft">{p.access}</p>
      {conn && (conn.accountRef || conn.branchRef || conn.supplierName) && (
        <p className="mt-1 text-xs text-muted">{[conn.supplierName && `Linked to ${conn.supplierName}`, conn.accountRef && `Account ${conn.accountRef}`, conn.branchRef && `Branch ${conn.branchRef}`, !conn.useForCrossCheck && "Not used in cross-check"].filter(Boolean).join(" · ")}</p>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        {canManage && !conn && !editing && <Button size="sm" variant="secondary" className="min-h-10" onClick={() => setEditing(true)} data-testid="provider-request">Request connection</Button>}
        {canManage && conn && !editing && <>
          <Button size="sm" variant="secondary" className="min-h-10" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="secondary" className="min-h-10" disabled={busy}
            onClick={() => send("POST", { provider: p.id, supplierId: conn.supplierId, accountRef: conn.accountRef, branchRef: conn.branchRef, useForCrossCheck: conn.useForCrossCheck, paused: conn.status !== "paused" }, conn.status === "paused" ? `${p.name} resumed.` : `${p.name} paused.`)}>
            {conn.status === "paused" ? "Resume" : "Pause"}</Button>
          <Button size="sm" variant="ghost" className="min-h-10" disabled={busy} onClick={() => send("DELETE", undefined, `${p.name} removed. Its account number was deleted.`)}>Remove</Button>
        </>}
        <a href={p.website} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 px-1 text-sm font-semibold text-accent-ink hover:underline">Website <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">(opens in a new tab)</span></a>
      </div>
      {editing && <ConnectForm provider={p} conn={conn} suppliers={suppliers} busy={busy} onCancel={() => setEditing(false)}
        onSave={(body) => send("POST", body, conn ? `${p.name} updated.` : `Request saved. ${p.name} will go live here once they approve access.`)} />}
    </li>
  );
}

function ConnectForm({ provider: p, conn, suppliers, busy, onCancel, onSave }: { provider: PricingProvider; conn?: SupplierConnection; suppliers: SupplierOption[]; busy: boolean; onCancel: () => void; onSave: (b: object) => void }) {
  const [supplierId, setSupplierId] = useState(conn?.supplierId ?? "");
  const [accountRef, setAccountRef] = useState(conn?.accountRef ?? "");
  const [branchRef, setBranchRef] = useState(conn?.branchRef ?? "");
  const [cross, setCross] = useState(conn?.useForCrossCheck ?? true);
  const [consent, setConsent] = useState(Boolean(conn));
  const id = `cf-${p.id}`;
  return (
    <form className="mt-3 space-y-3 rounded-lg border border-line bg-paper p-3" data-testid="connect-form"
      onSubmit={(e) => { e.preventDefault(); if (consent) onSave({ provider: p.id, supplierId: supplierId || null, accountRef, branchRef, useForCrossCheck: cross, paused: conn?.status === "paused" }); }}>
      {p.kind !== "market_data" && suppliers.length > 0 && (
        <label className="block text-sm"><span className="font-semibold">Your supplier record</span>
          <select className="field mt-1 h-10" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Not linked</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
      )}
      {p.accountLabel && <label className="block text-sm"><span className="font-semibold">{p.accountLabel}</span>
        <input className="field mt-1 h-10" maxLength={80} autoComplete="off" value={accountRef} onChange={(e) => setAccountRef(e.target.value)} /></label>}
      {p.branchLabel && <label className="block text-sm"><span className="font-semibold">{p.branchLabel}</span>
        <input className="field mt-1 h-10" maxLength={80} autoComplete="off" value={branchRef} onChange={(e) => setBranchRef(e.target.value)} /></label>}
      <p className="text-xs text-muted">Account and branch numbers only. Never enter a password here.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={cross} onChange={(e) => setCross(e.target.checked)} /> Use these prices in my price cross-check</label>
      {!conn && <label className="flex items-start gap-2 text-sm" htmlFor={`${id}-consent`}><input id={`${id}-consent`} type="checkbox" className="mt-1 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="connect-consent" />
        I authorize Built2Bid to request my pricing from {p.name} once access is available. I can pause or remove this anytime.</label>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="accent" className="min-h-10" type="submit" disabled={busy || !consent} data-testid="connect-save">{conn ? "Save" : "Save request"}</Button>
        <Button size="sm" variant="secondary" className="min-h-10" type="button" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
