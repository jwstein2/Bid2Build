"use client";
import Link from "next/link";
import { AlertTriangle, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import { trades } from "@/lib/trades/catalog";
import {
  FIELD_LABELS, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, REQUIRED_FIELDS, applyRows, autoMap, buildPreview, parseCsv, sheetToRows,
  type ImportField, type Mapping, type PreviewRow, type RowStatus,
} from "@/lib/pricing/import";
import { useLibrary } from "../builder/library";
import { Button } from "../ui/button";
import { Badge, Card, Notice } from "../ui/misc";
import { LibraryLocked } from "./premium-lock";
import { cn } from "@/lib/cn";
import { FileDrop } from "@/components/ui/file-drop";

type ImportRecord = {
  id: string; supplierName: string; fileName: string | null; effectiveOn: string; createdAt: string;
  created: number; updated: number; unchanged: number; status: "applied" | "undone"; restored: number | null; kept: number | null;
};
type Filter = "all" | "review" | RowStatus;

const STATUS: Record<RowStatus, { label: string; tone: "ok" | "brand" | "neutral" | "danger" | "warn" }> = {
  new: { label: "New item", tone: "ok" },
  changed: { label: "Price change", tone: "brand" },
  unchanged: { label: "No change", tone: "neutral" },
  invalid: { label: "Can't import", tone: "danger" },
  duplicate: { label: "Duplicate", tone: "warn" },
};
const today = () => new Date().toLocaleDateString("en-CA");
const fmtDay = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Supplier price-list import: upload a CSV or Excel file → confirm the columns → review every row
 * (new, changed, flagged) → import the ticked rows in one step → undo from the history if needed.
 * Only Saved Items change; estimates and sent proposals never do.
 */
export function PriceImport() {
  const lib = useLibrary(true);
  const [table, setTable] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [supplier, setSupplier] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [perUnit, setPerUnit] = useState(false);
  const [trade, setTrade] = useState("");
  const [include, setInclude] = useState<Record<number, boolean>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [ready, setReady] = useState(true);
  // Supplier directory (Projects → Team → Suppliers). Optional: empty when the feature is off or not set up.
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/team/suppliers", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!cancelled && d?.suppliers) setSuppliers((d.suppliers as { id: string; name: string; status: string }[]).filter((x) => x.status === "active").map((x) => ({ id: x.id, name: x.name })));
    }).catch(() => { /* offline or not available */ });
    return () => { cancelled = true; };
  }, []);
  const supplierMatch = suppliers.find((x) => x.name.trim().toLowerCase() === supplier.trim().toLowerCase()) ?? null;

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/library/import", { cache: "no-store" });
      if (r.ok) { const d = await r.json(); setHistory(d.imports ?? []); setReady(d.ready !== false); }
    } catch { /* offline */ }
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/library/import", { cache: "no-store" });
        if (r.ok && !cancelled) { const d = await r.json(); setHistory(d.imports ?? []); setReady(d.ready !== false); }
      } catch { /* offline */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const items = useMemo(() => lib.items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, unitCost: i.unitCost, supplierSku: i.supplierSku ?? null })), [lib.items]);
  const preview = useMemo(() => (table && mapping && mapping.name !== null && mapping.unitCost !== null ? buildPreview({ rows: table, mapping, items, perUnit }) : null), [table, mapping, items, perUnit]);
  const rows: PreviewRow[] = useMemo(() => (preview?.rows ?? []).map((r) => (r.line in include ? { ...r, include: include[r.line] && (r.status === "new" || r.status === "changed") } : r)), [preview, include]);
  const picked = rows.filter((r) => r.include);
  const shown = rows.filter((r) => filter === "all" || (filter === "review" ? r.bigChange || r.unitMismatch : r.status === filter));

  async function onFile(f: File | undefined) {
    setError(null); setDone(null); setInclude({}); setFilter("all");
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) { setError("That file is over 5 MB. Split it into smaller price lists, or remove columns you don’t need."); return; }
    try {
      let data: string[][];
      if (/\.(xlsx|xlsm)$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        data = sheetToRows((await readSheet(f)) as unknown[][]);
      } else if (/\.(csv|txt|tsv)$/i.test(f.name) || f.type.includes("csv") || f.type.startsWith("text/")) {
        data = parseCsv(await f.text());
      } else {
        setError("Use a CSV or Excel (.xlsx) file. For an older .xls file, open it in Excel and Save As .xlsx or CSV.");
        return;
      }
      if (data.length < 2) { setError("That file has no rows under the header."); return; }
      if (data.length - 1 > MAX_IMPORT_ROWS) setError(`Only the first ${MAX_IMPORT_ROWS.toLocaleString()} rows will be read. Split larger price lists into several files.`);
      setTable(data);
      setFileName(f.name);
      setMapping(autoMap(data[0]));
      if (!supplier) setSupplier(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 120));
    } catch {
      setError("Couldn't read that file. Check it opens in Excel, or save it as CSV and try again.");
    }
  }

  async function apply() {
    if (!preview || !picked.length) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/library/import", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "apply", supplierName: supplier.trim(), ...(supplierMatch ? { supplierId: supplierMatch.id } : {}), fileName, effectiveOn, rows: applyRows(picked, { trade: trade || null }) }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setError(d?.error?.message ?? "Couldn't import. Nothing was changed."); return; }
      const res = d.result as { created: number; updated: number };
      setDone(`Imported: ${res.created} new item${res.created === 1 ? "" : "s"}, ${res.updated} price${res.updated === 1 ? "" : "s"} updated. Estimates you already sent are unchanged.`);
      setTable(null); setMapping(null); setInclude({});
      await Promise.all([lib.reload(), loadHistory()]);
    } catch {
      setError("You're offline. Nothing was changed.");
    } finally { setBusy(false); }
  }

  async function undo(id: string) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/library/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo", importId: id }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setError(d?.error?.message ?? "Couldn't undo that import."); return; }
      const res = d.result as { restored: number; removed: number; kept: number };
      setDone(`Undone: ${res.restored} price${res.restored === 1 ? "" : "s"} restored, ${res.removed} new item${res.removed === 1 ? "" : "s"} removed${res.kept ? `, ${res.kept} kept because you changed them after the import` : ""}.`);
      await Promise.all([lib.reload(), loadHistory()]);
    } finally { setBusy(false); }
  }

  if (!lib.loaded) return <Card className="p-6 text-center text-muted">Loading your Saved Items…</Card>;
  if (!lib.access) return <LibraryLocked signedIn lockedCount={lib.lockedCount} />;

  const missing = mapping ? REQUIRED_FIELDS.filter((f) => mapping[f] === null) : [];
  const c = preview?.counts;

  return (
    <div className="space-y-6" data-testid="price-import">
      {!ready && <Notice tone="warn" title="Almost ready">Supplier imports switch on after a database update. Your Saved Items work as usual.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}

      <Card className="space-y-4 p-4 md:p-5">
        <h2 className="font-display text-lg font-bold">1. Choose the price list</h2>
        <FileDrop className="rounded-xl" label="Drop the price list to read it" disabled={busy}>
        <label className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-strong p-6 text-center hover:bg-brand-tint", busy && "pointer-events-none opacity-60")}>
          <Upload className="h-6 w-6 text-brand" aria-hidden />
          <span className="font-semibold">{fileName && table ? fileName : "Upload or drag in a CSV or Excel file"}</span>
          <span className="text-xs text-muted">From your supplier’s account portal or rep. Up to {MAX_IMPORT_ROWS.toLocaleString()} rows. Nothing changes until you review and import.</span>
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" data-testid="price-import-file" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        </FileDrop>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="pi-supplier" className="label">Supplier</label>
            <input id="pi-supplier" className="field" list="pi-supplier-list" value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. ABC Supply – Springfield" data-testid="price-import-supplier" />
            <datalist id="pi-supplier-list">{suppliers.map((x) => <option key={x.id} value={x.name} />)}</datalist>
            {suppliers.length > 0 && supplier.trim() && <span className="mt-1 block text-xs text-muted" data-testid="price-import-supplier-hint">{supplierMatch ? "From your supplier list." : "New supplier: it's added to your supplier list when you import."}</span>}
          </div>
          <div>
            <label htmlFor="pi-date" className="label">Prices effective</label>
            <input id="pi-date" type="date" className="field" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pi-trade" className="label">File new items under</label>
            <select id="pi-trade" className="field" value={trade} onChange={(e) => setTrade(e.target.value)}>
              <option value="">General (no trade)</option>
              {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {table && mapping && (
        <Card className="space-y-4 p-4 md:p-5" data-testid="price-import-mapping">
          <h2 className="font-display text-lg font-bold">2. Match the columns</h2>
          <p className="text-sm text-ink-soft">We guessed from the header row. Fix any that are wrong.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(FIELD_LABELS) as ImportField[]).map((f) => (
              <div key={f}>
                <label htmlFor={`map-${f}`} className="label">{FIELD_LABELS[f]}{REQUIRED_FIELDS.includes(f) ? " *" : ""}</label>
                <select id={`map-${f}`} className="field" value={mapping[f] ?? ""} onChange={(e) => { setInclude({}); setMapping({ ...mapping, [f]: e.target.value === "" ? null : Number(e.target.value) }); }}>
                  <option value="">— not in this file —</option>
                  {table[0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>
          {mapping.packSize !== null && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={perUnit} onChange={(e) => setPerUnit(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" />
              <span><b>Prices are per pack.</b> Divide by the pack size to save a price per unit (e.g. $120 box of 4 → $30 each).</span>
            </label>
          )}
          {missing.length > 0 && <Notice tone="warn">Pick a column for {missing.map((f) => FIELD_LABELS[f]).join(" and ")}.</Notice>}
        </Card>
      )}

      {preview && c && (
        <Card className="space-y-3 p-4 md:p-5" data-testid="price-import-preview">
          <h2 className="font-display text-lg font-bold">3. Review and import</h2>
          <div className="flex flex-wrap gap-2 text-sm" role="tablist" aria-label="Filter rows">
            {([["all", `All ${rows.length}`], ["new", `New ${c.new}`], ["changed", `Price changes ${c.changed}`], ["review", `Needs review ${preview.flagged}`], ["unchanged", `No change ${c.unchanged}`], ["invalid", `Can't import ${c.invalid + c.duplicate}`]] as [Filter, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn("min-h-9 rounded-full border px-3", filter === k ? "border-brand bg-brand text-white" : "border-line-strong hover:bg-black/5")}>{l}</button>
            ))}
          </div>
          {preview.flagged > 0 && (
            <p className="flex items-start gap-2 text-sm text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{preview.flagged} row{preview.flagged === 1 ? "" : "s"} changed more than 25% or use a different unit than your saved item. They’re unticked until you check them.</p>
          )}
          <div className="-mx-4 overflow-x-auto md:mx-0">
            <table className="w-full min-w-[640px] text-sm" data-testid="price-import-table">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="w-10 px-2 py-2"><span className="sr-only">Import</span></th><th className="px-2 py-2">Product</th><th className="px-2 py-2">Unit</th><th className="px-2 py-2 text-right">Saved price</th><th className="px-2 py-2 text-right">New price</th><th className="px-2 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.slice(0, 500).map((r) => {
                  const can = r.status === "new" || r.status === "changed";
                  return (
                    <tr key={r.line} className={cn(!r.include && "text-ink-soft")} data-status={r.status}>
                      <td className="px-2 py-2">
                        <input type="checkbox" aria-label={`Import ${r.name || `line ${r.line}`}`} disabled={!can} checked={r.include} onChange={(e) => setInclude({ ...include, [r.line]: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand)] max-md:h-5 max-md:w-5" />
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-medium text-ink">{r.name || <i>no name</i>}</span>
                        <span className="block text-xs text-muted">{r.sku ? `#${r.sku} · ` : ""}line {r.line}{r.match ? ` · matches “${r.match.name}” by ${r.match.by === "sku" ? "SKU" : "name"}` : ""}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{r.unit}{r.unitMismatch && <span className="block text-xs text-warn">saved as {r.match?.unit}</span>}</td>
                      <td className="tabular whitespace-nowrap px-2 py-2 text-right">{r.match?.unitCost ? formatCurrency(r.match.unitCost) : "—"}</td>
                      <td className="tabular whitespace-nowrap px-2 py-2 text-right font-semibold">
                        {r.unitCost ? formatCurrency(r.unitCost) : r.filePrice || "—"}
                        {r.changePct && <span className={cn("block text-xs font-normal", r.bigChange ? "text-warn" : "text-muted")}>{Number(r.changePct) > 0 ? "+" : ""}{r.changePct}%</span>}
                        {perUnit && r.packSize && <span className="block text-xs font-normal text-muted">{formatCurrency(r.filePrice)} ÷ {r.packSize}</span>}
                      </td>
                      <td className="px-2 py-2"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>{r.error && <span className="block text-xs text-danger">{r.error}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > 500 && <p className="px-2 py-2 text-xs text-muted">Showing the first 500 of {shown.length} rows. All ticked rows are imported.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <Button onClick={apply} disabled={busy || !picked.length || !supplier.trim() || !ready} data-testid="price-import-apply">
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> {busy ? "Importing…" : `Import ${picked.length} price${picked.length === 1 ? "" : "s"}`}
            </Button>
            <span className="text-xs text-muted">Updates your Saved Items only. Bids you already sent, approved or signed keep their prices. You can undo this import.</span>
          </div>
        </Card>
      )}

      <Card className="p-4 md:p-5" data-testid="price-import-history">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Import history</h2>
          {suppliers.length > 0 && <Link href="/projects/team/suppliers" className="text-sm font-semibold text-accent-ink underline" data-testid="price-import-suppliers-link">Your suppliers</Link>}
        </div>
        {history.length === 0 ? <p className="mt-2 text-sm text-muted">No supplier imports yet.</p> : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-semibold">{h.supplierName}</span>{h.fileName ? <span className="text-muted"> · {h.fileName}</span> : null}
                  <span className="block text-xs text-muted">
                    Effective {fmtDay(h.effectiveOn)} · {h.created} new, {h.updated} updated{h.unchanged ? `, ${h.unchanged} unchanged` : ""}
                    {h.status === "undone" ? ` · undone${h.kept ? ` (${h.kept} kept)` : ""}` : ""}
                  </span>
                </span>
                {h.status === "applied"
                  ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void undo(h.id)}><RotateCcw className="h-4 w-4" aria-hidden /> Undo</Button>
                  : <Badge>Undone</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
