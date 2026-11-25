"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Printer, Search } from "lucide-react";
import Link from "next/link";
import { Button, Spinner } from "@/components/ui/button";
import { finAction } from "@/components/financials/fin-client";

export interface Opt { id: string; label: string }

/** Run one action, show its result in a live region, refresh the server data on success. */
export function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const run = async (payload: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    const r = await finAction(payload);
    setBusy(false);
    if (!r.ok) { setMsg({ tone: "danger", text: r.message }); return null; }
    setMsg({ tone: "ok", text: ok });
    router.refresh();
    return r.data;
  };
  return { busy, msg, run, setMsg };
}

export function Status({ msg, busy }: { msg: { tone: "ok" | "danger"; text: string } | null; busy?: boolean }) {
  return <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 text-sm ${msg?.tone === "danger" ? "text-danger" : "text-muted"}`}>{busy ? <><Spinner className="h-3.5 w-3.5" />Saving…</> : msg?.text}</span>;
}

/**
 * Fill in a missing project / cost code / vendor / scope section on an expense or bill line. Flat selects
 * only. A value that is already set shows as text: changing it is a correction (void + re-record), so the
 * record's history stays intact. Nothing is filled in automatically.
 */
export function ClassifyControls({ c, jobs, codes, vendors, sections, canWrite }: {
  c: { entityType: "expense" | "bill_line"; entityId: string; jobId: string | null; costCodeId: string | null; vendorId: string | null; scopeSectionId: string | null; canVendor: boolean };
  jobs: Opt[]; codes: Opt[]; vendors: Opt[]; sections: (Opt & { jobId: string })[]; canWrite: boolean;
}) {
  const { busy, msg, run } = useAct();
  const [job, setJob] = useState(""); const [code, setCode] = useState(""); const [vendor, setVendor] = useState(""); const [scope, setScope] = useState("");
  const jobNow = c.jobId ?? job;
  const scopeOpts = sections.filter((s) => s.jobId === jobNow);
  const name = (opts: Opt[], v: string | null) => opts.find((o) => o.id === v)?.label ?? "Set";
  const changed = Boolean(job || code || vendor || scope);
  const id = c.entityId.slice(0, 8);
  if (!canWrite) return null;
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" data-testid={`fin-classify-${c.entityId}`}
      onSubmit={(e) => { e.preventDefault(); void run({ action: "cost_fill", entityType: c.entityType, entityId: c.entityId, p: { jobId: job || undefined, costCodeId: code || undefined, vendorId: vendor || undefined, scopeSectionId: scope || undefined } }, "Saved."); }}>
      <label className="min-w-40 flex-1 text-xs font-semibold text-ink-soft" htmlFor={`cj-${id}`}>Project
        {c.jobId ? <span className="block min-h-9 py-2 text-sm font-normal text-ink">{name(jobs, c.jobId)}</span>
          : <select id={`cj-${id}`} className="field field-sm mt-1" value={job} onChange={(e) => { setJob(e.target.value); setScope(""); }}><option value="">Leave as overhead</option>{jobs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
      </label>
      <label className="min-w-40 flex-1 text-xs font-semibold text-ink-soft" htmlFor={`cc-${id}`}>Cost code
        {c.costCodeId ? <span className="block min-h-9 py-2 text-sm font-normal text-ink">{name(codes, c.costCodeId)}</span>
          : <select id={`cc-${id}`} className="field field-sm mt-1" value={code} onChange={(e) => setCode(e.target.value)}><option value="">Choose…</option>{codes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
      </label>
      {c.canVendor && (
        <label className="min-w-40 flex-1 text-xs font-semibold text-ink-soft" htmlFor={`cv-${id}`}>Vendor
          {c.vendorId ? <span className="block min-h-9 py-2 text-sm font-normal text-ink">{name(vendors, c.vendorId)}</span>
            : <select id={`cv-${id}`} className="field field-sm mt-1" value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="">Choose…</option>{vendors.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
        </label>
      )}
      {jobNow && scopeOpts.length > 0 && (
        <label className="min-w-40 flex-1 text-xs font-semibold text-ink-soft" htmlFor={`cs-${id}`}>Scope section
          {c.scopeSectionId ? <span className="block min-h-9 py-2 text-sm font-normal text-ink">{name(scopeOpts, c.scopeSectionId)}</span>
            : <select id={`cs-${id}`} className="field field-sm mt-1" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Choose…</option>{scopeOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
        </label>
      )}
      <Button type="submit" size="sm" disabled={busy || !changed}>Save</Button>
      <Status msg={msg} busy={busy} />
    </form>
  );
}

/** A suspected duplicate expense: void it as a duplicate of the other one, or say it's real. */
export function DuplicateActions({ expenseId, keep, reviewItemId, canWrite }: { expenseId?: string; keep: { id: string; number: string } | null; reviewItemId: string; canWrite: boolean }) {
  const { busy, msg, run } = useAct();
  if (!canWrite) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {keep && expenseId && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run({ action: "mark_duplicate", expenseId, keepId: keep.id }, `Voided; ${keep.number} kept.`)}>Void this one, keep {keep.number}</Button>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "review_resolve", itemId: reviewItemId, status: "dismissed", resolution: "Not a duplicate (checked in Accountant Mode)" }, "Marked as not a duplicate.")}>Not a duplicate</Button>
      <Status msg={msg} busy={busy} />
    </div>
  );
}

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return <Button type="button" variant="secondary" size="sm" className="no-print" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> {label}</Button>;
}

export interface CatalogItem { key: string; label: string; description: string; status: "available" | "blocked"; href?: string; keywords: string; blockedBy?: string; csv?: string }

/** Searchable reports catalog. Blocked reports are information rows with what they need, never a button. */
export function ReportCatalog({ items, canExport }: { items: CatalogItem[]; canExport: boolean }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return items.filter((r) => !t || `${r.label} ${r.description} ${r.keywords}`.toLowerCase().includes(t)); }, [q, items]);
  const avail = shown.filter((r) => r.status === "available"), blocked = shown.filter((r) => r.status === "blocked");
  return (
    <div className="space-y-4" data-guide="fin.acct-catalog">
      <label className="relative block max-w-xl" htmlFor="rep-q">
        <span className="sr-only">Search reports</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input id="rep-q" type="search" className="field pl-9" placeholder="Search reports, e.g. aging, 1099, labor" value={q} onChange={(e) => setQ(e.target.value)} data-testid="fin-report-search" />
      </label>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Available reports">
        {avail.map((r) => (
          <li key={r.key} className="flex flex-col rounded-xl border border-line bg-surface p-4">
            <Link href={r.href!} className="font-display text-base font-extrabold text-accent-ink underline" data-testid={`fin-report-${r.key}`}>{r.label}</Link>
            <p className="mt-1 flex-1 text-sm text-ink-soft">{r.description}</p>
            {canExport && r.csv && <a href={`/api/financials/export?kind=${r.csv}`} className="mt-2 inline-flex min-h-9 items-center text-sm font-semibold text-accent-ink underline">Download CSV</a>}
          </li>
        ))}
      </ul>
      {!avail.length && <p className="text-sm text-muted">No report matches “{q}”.</p>}
      {blocked.length > 0 && (
        <section aria-labelledby="rep-blocked" className="rounded-xl border border-dashed border-line p-4">
          <h2 id="rep-blocked" className="font-display text-base font-extrabold">Not available yet</h2>
          <p className="text-sm text-ink-soft">These need the general ledger, which isn&apos;t built yet. No numbers are shown for them.</p>
          <ul className="mt-2 divide-y divide-line">
            {blocked.map((r) => <li key={r.key} className="py-2 text-sm"><span className="font-semibold">{r.label}</span> <span className="text-muted">· {r.blockedBy}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
