"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, Building2, ChevronDown, ChevronUp, ExternalLink, FileSpreadsheet, Mail, Pencil, Phone, Plus, RotateCcw, Scale, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { tradeLabel } from "@/lib/projects/team";
import { num, websiteHref, type Supplier, type SupplierList } from "@/lib/team/records";

type Detail = { imports: { id: string; fileName: string | null; effectiveOn: string; rows: number; created: number; updated: number; unchanged: number; status: string; createdAt: string; linked: boolean }[];
  items: { id: string; name: string; unit: string; unitCost: unknown; sku: string | null; priceSource: string; effectiveOn: string | null }[] };
const money = (v: unknown) => { const n = num(v); return n === null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }); };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/**
 * Suppliers: who you buy from, your account number and rep, and the price lists you've imported from
 * each one. Imports made under the same supplier name link automatically.
 */
export function SupplierDirectory({ list }: { list: SupplierList }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail | "loading" | "error">>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const shown = list.suppliers.filter((s) => (archived ? s.status === "archived" : s.status === "active"))
    .filter((s) => { const t = q.trim().toLowerCase(); return !t || [s.name, s.repName, s.accountNumber, s.phone, s.email, ...s.trades].some((x) => x?.toLowerCase().includes(t)); });

  async function toggle(s: Supplier) {
    if (open === s.id) { setOpen(null); return; }
    setOpen(s.id);
    if (detail[s.id] && detail[s.id] !== "error") return;
    setDetail((d) => ({ ...d, [s.id]: "loading" }));
    const r = await api<Detail>(`/api/team/suppliers/${s.id}`);
    setDetail((d) => ({ ...d, [s.id]: r.ok ? r.data : "error" }));
  }
  async function setStatus(s: Supplier, status: "active" | "archived") {
    const r = await api(`/api/team/suppliers/${s.id}`, { method: "POST", body: JSON.stringify({ status }) });
    setMsg(r.ok ? { ok: true, text: status === "archived" ? `${s.name} archived. Past price lists keep their link.` : `${s.name} restored.` } : { ok: false, text: r.message });
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-4" data-testid="supplier-directory">
      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-0 flex-1 basis-56"><span className="sr-only">Search suppliers</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field h-10 pl-9" placeholder="Search name, rep, account #, trade" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <Button size="sm" variant="secondary" className="min-h-10" onClick={() => setArchived(!archived)} aria-pressed={archived}>{archived ? "Show active" : "Show archived"}</Button>
        <Link href="/dashboard/items/import" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-paper"><FileSpreadsheet className="h-4 w-4" aria-hidden /> Import a price list</Link>
        <Link href="/projects/team/pricing" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-paper" data-testid="supplier-pricing-link"><Scale className="h-4 w-4" aria-hidden /> Compare prices &amp; connect</Link>
        {list.canManage && <Button size="sm" variant="accent" className="min-h-10" onClick={() => setEditing("new")} data-testid="supplier-add"><Plus className="h-4 w-4" aria-hidden /> Add supplier</Button>}
      </div>
      {!list.canManage && <Notice>You can view your company&apos;s suppliers. Ask your company admin to add or change one.</Notice>}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      {editing && <SupplierForm initial={editing === "new" ? null : editing} onCancel={() => setEditing(null)}
        onSaved={(name) => { setEditing(null); setMsg({ ok: true, text: `${name} saved.` }); router.refresh(); }} />}

      {shown.length === 0 && !editing && (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted" data-testid="supplier-empty">
          {list.suppliers.length === 0 ? <>Add the suppliers you buy from, or import a price list and the supplier is added for you.</> : "No suppliers match."}
        </div>
      )}

      <ul className="space-y-3">
        {shown.map((s) => {
          const d = detail[s.id];
          const href = websiteHref(s.website);
          return (
            <li key={s.id} className="rounded-xl border border-line bg-surface p-4" data-testid="supplier-card">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper text-navy"><Building2 className="h-4 w-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-navy">{s.name}{s.status === "archived" && <Badge tone="warn">Archived</Badge>}</p>
                  <p className="text-sm text-ink-soft">{[s.repName && `Rep: ${s.repName}`, s.accountNumber && `Account # ${s.accountNumber}`].filter(Boolean).join(" · ") || "No rep or account number yet"}</p>
                  {s.trades.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{s.trades.map((t) => <span key={t} className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold text-ink-soft">{tradeLabel(t)}</span>)}</p>}
                  <p className="mt-1 text-xs text-muted">{s.imports} price list{s.imports === 1 ? "" : "s"} imported{s.lastImportAt ? `, last ${day(s.lastImportAt)}` : ""} · prices {s.pricedItems} of your Saved Items</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
                {s.phone && <a href={`tel:${s.phone}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 font-semibold"><Phone className="h-4 w-4" aria-hidden />{s.phone}</a>}
                {s.email && <a href={`mailto:${s.email}`} className="inline-flex min-h-9 min-w-0 items-center gap-1 rounded-lg border border-line px-2.5 font-semibold"><Mail className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{s.email}</span></a>}
                {href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 font-semibold"><ExternalLink className="h-4 w-4" aria-hidden />Website</a>}
                <Button size="sm" variant="ghost" onClick={() => toggle(s)} aria-expanded={open === s.id} data-testid="supplier-toggle">
                  {open === s.id ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />} Price lists &amp; items</Button>
                {list.canManage && <span className="ml-auto flex gap-1">
                  {s.status === "active" && <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>}
                  {s.status === "active"
                    ? <Button size="sm" variant="ghost" onClick={() => setStatus(s, "archived")} aria-label={`Archive ${s.name}`}><Archive className="h-4 w-4" aria-hidden /></Button>
                    : <Button size="sm" variant="ghost" onClick={() => setStatus(s, "active")}><RotateCcw className="h-4 w-4" aria-hidden /> Restore</Button>}
                </span>}
              </div>
              {open === s.id && (
                <div className="mt-3 space-y-3 rounded-lg bg-paper p-3 text-sm" data-testid="supplier-detail">
                  {d === "loading" || !d ? <p className="text-muted">Loading…</p> : d === "error" ? <p className="text-danger">Couldn&apos;t load this supplier&apos;s price lists.</p> : (
                    <>
                      <div>
                        <p className="font-semibold text-navy">Your price lists from {s.name}</p>
                        {d.imports.length === 0 ? <p className="text-muted">None yet. <Link href="/dashboard/items/import" className="font-semibold text-accent-ink underline">Import one</Link> and type “{s.name}” as the supplier.</p> : (
                          <ul className="mt-1 divide-y divide-line">{d.imports.map((i) => (
                            <li key={i.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                              <span>{day(i.createdAt)}{i.fileName ? ` · ${i.fileName}` : ""}{i.status === "undone" ? " · undone" : ""}</span>
                              <span className="text-muted">{i.created} new · {i.updated} updated · {i.unchanged} unchanged</span>
                            </li>))}</ul>)}
                      </div>
                      <div>
                        <p className="font-semibold text-navy">Saved Items priced by {s.name} ({d.items.length})</p>
                        {d.items.length === 0 ? <p className="text-muted">None of your Saved Items list this supplier yet.</p> : (
                          <ul className="mt-1 max-h-64 divide-y divide-line overflow-y-auto">{d.items.map((i) => (
                            <li key={i.id} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{i.name}{i.sku ? <span className="text-muted"> · {i.sku}</span> : null}</span>
                              <span className="shrink-0 font-semibold">{money(i.unitCost)} / {i.unit}</span></li>))}</ul>)}
                        <Link href="/dashboard/items" className="mt-1 inline-block font-semibold text-accent-ink underline">Open Saved Items</Link>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">Price lists and Saved Items are your own; the supplier list is shared with your company. Nothing is sent to a supplier.</p>
    </div>
  );
}

function SupplierForm({ initial, onCancel, onSaved }: { initial: Supplier | null; onCancel: () => void; onSaved: (name: string) => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? "", accountNumber: initial?.accountNumber ?? "", repName: initial?.repName ?? "", email: initial?.email ?? "",
    phone: initial?.phone ?? "", website: initial?.website ?? "", address: initial?.address ?? "", notes: initial?.notes ?? "", trades: (initial?.trades ?? []).join(", "),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true); setErr(null);
    const body = { ...(initial ? { id: initial.id } : {}), ...f, name: f.name.trim(), trades: f.trades.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) };
    const r = await api<{ id: string }>("/api/team/suppliers", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    onSaved(body.name);
  }
  const field = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <label className="block"><span className="label">{label}</span><input className="field" value={f[k]} onChange={set(k)} {...props} /></label>
  );
  return (
    <div className="space-y-3 rounded-xl border border-line bg-paper p-4" data-testid="supplier-form">
      <p className="font-semibold text-navy">{initial ? `Edit ${initial.name}` : "Add a supplier"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Supplier name", { maxLength: 200, placeholder: "e.g. ABC Supply – Springfield", "data-testid": "supplier-name" })}
        {field("accountNumber", "Your account number (optional)", { maxLength: 80 })}
        {field("repName", "Sales rep (optional)", { maxLength: 200 })}
        {field("phone", "Phone (optional)", { maxLength: 40, type: "tel" })}
        {field("email", "Email (optional)", { maxLength: 320, type: "email" })}
        {field("website", "Website or ordering portal (optional)", { maxLength: 300, placeholder: "e.g. abcsupply.com" })}
        {field("address", "Branch address (optional)", { maxLength: 500 })}
        {field("trades", "Trades (comma separated, optional)", { maxLength: 400, placeholder: "e.g. Roofing, Siding" })}
      </div>
      <label className="block"><span className="label">Notes (internal only)</span><textarea className="field min-h-16" value={f.notes} maxLength={2000} onChange={set("notes")} /></label>
      {err && <Notice tone="danger">{err}</Notice>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy || !f.name.trim()} data-testid="supplier-save">{busy ? "Saving…" : initial ? "Save changes" : "Add supplier"}</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
