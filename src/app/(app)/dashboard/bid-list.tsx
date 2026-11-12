"use client";
import Link from "next/link";
import { Archive, Copy, Download, Eye, Pencil, Search, Trash2, ArchiveRestore, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { tradeName } from "@/lib/trades/catalog";
import { formatCurrency } from "@/lib/estimate/money";
import { Badge, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { deleteEstimate, duplicateEstimate, renameEstimate, setArchived } from "./actions";

export interface BidRow {
  id: string; title: string; customer: string; trades: string[]; status: "draft" | "finalized" | "archived"; updatedAt: string; number: string;
  latestVersion: { id: string; number: number; total: number } | null;
}

const FILTERS = [["active", "All active"], ["draft", "Drafts"], ["finalized", "Finalized"], ["archived", "Archived"]] as const;

export function BidList({ rows }: { rows: BidRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("active");
  const [trade, setTrade] = useState("");
  const tradesUsed = Array.from(new Set(rows.flatMap((r) => r.trades)));
  const list = rows.filter((r) => {
    if (filter === "active" ? r.status === "archived" : r.status !== filter) return false;
    if (trade && !r.trades.includes(trade)) return false;
    const s = q.trim().toLowerCase();
    return !s || r.title.toLowerCase().includes(s) || r.customer.toLowerCase().includes(s) || r.number.toLowerCase().includes(s);
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input aria-label="Search bids" className="field pl-9" placeholder="Search by project, customer, or number" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {FILTERS.map(([v, l]) => (
            <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)} className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium ${filter === v ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5"}`}>{l}</button>
          ))}
        </div>
        {tradesUsed.length > 1 && (
          <select aria-label="Filter by trade" className="field w-auto" value={trade} onChange={(e) => setTrade(e.target.value)}>
            <option value="">All trades</option>{tradesUsed.map((t) => <option key={t} value={t}>{tradeName(t)}</option>)}
          </select>
        )}
      </div>
      {list.length === 0 ? (
        <div className="p-10 text-center">
          <p className="font-semibold">{rows.length ? "No bids match." : "No bids yet."}</p>
          {!rows.length && <><p className="mt-1 text-sm text-muted">Pick a trade and you&apos;ll have a draft in seconds.</p><Link href="/bids" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 font-semibold text-navy hover:bg-accent-hover">Create your first bid</Link></>}
        </div>
      ) : (
        <ul className="divide-y divide-line">{list.map((r) => <Row key={r.id} r={r} />)}</ul>
      )}
    </Card>
  );
}

function Row({ r }: { r: BidRow }) {
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(r.title);
  const [dl, setDl] = useState(false);

  async function download() {
    if (!r.latestVersion) return;
    setDl(true);
    try {
      const res = await fetch(`/api/estimates/${r.id}/versions/${r.latestVersion.id}`);
      const d = await res.json();
      if (d.url) window.location.assign(d.url);
      else if (d.pdfBase64) {
        const bytes = Uint8Array.from(atob(d.pdfBase64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        Object.assign(document.createElement("a"), { href: url, download: d.filename }).click();
      }
    } finally { setDl(false); }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); start(() => renameEstimate(r.id, title)); setRenaming(false); }}>
            <input autoFocus aria-label="New name" className="field field-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button size="sm" type="submit">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
          </form>
        ) : (
          <Link href={`/estimates/${r.id}`} className="font-semibold hover:text-brand">{r.title}</Link>
        )}
        <p className="text-sm text-muted">
          {[r.customer, r.trades.map(tradeName).join(" + "), `#${r.number}`, `Edited ${new Date(r.updatedAt).toLocaleDateString()}`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={r.status === "finalized" ? "ok" : r.status === "archived" ? "neutral" : "brand"}>{r.status === "finalized" ? `Finalized v${r.latestVersion?.number ?? 1}` : r.status === "archived" ? "Archived" : "Draft"}</Badge>
        {r.latestVersion && <span className="tabular text-sm font-semibold">{formatCurrency(String(r.latestVersion.total))}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <IconLink href={`/estimates/${r.id}`} label="Open / edit"><Pencil className="h-4 w-4" /></IconLink>
        <IconLink href={`/estimates/${r.id}?step=proposal`} label="Preview"><Eye className="h-4 w-4" /></IconLink>
        <IconBtn label={r.latestVersion ? "Download latest PDF (no credit used)" : "Export from the editor first"} onClick={download} disabled={!r.latestVersion || dl}>{dl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}</IconBtn>
        <IconBtn label="Duplicate" onClick={() => start(() => duplicateEstimate(r.id))} disabled={pending}><Copy className="h-4 w-4" /></IconBtn>
        <IconBtn label="Rename" onClick={() => setRenaming(true)}><span className="text-xs font-bold">Aa</span></IconBtn>
        <IconBtn label={r.status === "archived" ? "Restore" : "Archive"} onClick={() => start(() => setArchived(r.id, r.status !== "archived"))} disabled={pending}>{r.status === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</IconBtn>
        {confirmDelete ? (
          <span className="flex items-center gap-1 text-sm">
            <Button size="sm" variant="danger" onClick={() => start(() => deleteEstimate(r.id))} disabled={pending}>Delete forever</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </span>
        ) : (
          <IconBtn label="Delete" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 text-danger" /></IconBtn>
        )}
      </div>
    </li>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button title={label} aria-label={label} onClick={onClick} disabled={disabled} className="grid h-10 w-10 place-items-center rounded-md text-ink-soft hover:bg-brand-tint hover:text-navy disabled:opacity-40">{children}</button>;
}
function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return <Link href={href} title={label} aria-label={label} className="grid h-10 w-10 place-items-center rounded-md text-ink-soft hover:bg-brand-tint hover:text-navy">{children}</Link>;
}
