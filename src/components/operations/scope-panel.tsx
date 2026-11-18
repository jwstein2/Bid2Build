"use client";
import { Camera, ChevronDown, Copy, Eye, History, Loader2, Lock, Share2, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import { DEFAULT_SHARE_FIELDS, JOB_FIELDS, SCOPE_FIELDS, SHARE_PRICING, SHAREABLE_FIELDS, type ScopeSection, type ShareField, type SharedPricing, type SharePricing } from "@/lib/operations/scope";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { Drawer } from "../projects/task-drawer";
import { ResourcePicker, type DirectoryResource } from "../projects/resource-picker";

interface Resource { id: string; name: string; kind: string; email: string | null; phone: string | null; trades?: string[] }
interface Share { id: string; sectionId: string; resourceId: string | null; createdAt: string; expiresAt: string; revokedAt: string | null; version: number; sectionRevision: number; sharedAt: string; fields: string[] | null; photoCount: number }
interface QuoteChip { itemName: string; vendorName: string; resourceId: string | null; latest: string | null; status: string }
interface ScopeData {
  available: boolean; sections: ScopeSection[]; canManage: boolean; canShare: boolean; shares: Share[]; resources: Resource[];
  quotesByGroup: Record<string, QuoteChip[]>; showCosts: boolean; photoCount: Record<string, number>;
}
const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/**
 * Trade scope workspace (V4.3): one section per approved proposal section. Internal notes,
 * subcontractor-facing instructions and customer-facing notes are separate fields; only fields the PM
 * picks are ever shared, and internal notes can never be shared.
 */
export function ScopePanel({ estimateId }: { estimateId: string }) {
  const [data, setData] = useState<ScopeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<ScopeSection | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/estimates/${estimateId}/scope`, { cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (!r.ok) { setError(d?.error?.message ?? "We couldn't load the scope."); return; }
    setData(d); setError(null);
  }, [estimateId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load on mount; state is set after the fetch resolves
  useEffect(() => { void load(); }, [load]);

  const init = async () => {
    setBusy(true);
    const r = await fetch(`/api/estimates/${estimateId}/scope`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "init" }) });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setError(d?.error?.message ?? "We couldn't build the scope."); return; }
    void load();
  };

  if (error) return <p className="text-sm text-danger" role="alert">{error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading scope…</p>;
  if (!data.available) return <p className="text-sm text-muted">The trade scope workspace turns on after the project operations update is installed.</p>;
  const resName = (id: string | null) => data.resources.find((r) => r.id === id)?.name ?? null;
  // A contact added inline shows up in every section's picker right away (the reload confirms it).
  const addResource = (r: DirectoryResource) => setData((d) => (d && !d.resources.some((x) => x.id === r.id) ? { ...d, resources: [...d.resources, { email: null, phone: null, ...r }] } : d));
  const unassigned = data.sections.filter((x) => !x.resource_id);

  return (
    <div className="space-y-3" data-testid="scope-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Built from the approved proposal. Assign each section from your Team directory and share only what a subcontractor needs.</p>
        {data.canManage && <Button size="sm" variant={data.sections.length ? "ghost" : "primary"} onClick={() => void init()} disabled={busy}>{data.sections.length ? "Add missing sections" : "Build scope from approved proposal"}</Button>}
      </div>
      {!data.sections.length && <p className="rounded-xl border border-dashed border-line p-6 text-sm text-muted">No scope sections yet{data.canManage ? "." : ". A project manager can build them from the approved proposal."}</p>}
      {data.canManage && data.sections.length > 1 && unassigned.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-line bg-paper p-3" data-testid="bulk-assign">
          <p className="text-sm"><span className="font-semibold">{unassigned.length} unassigned {unassigned.length === 1 ? "section" : "sections"}.</span> <span className="text-muted">Assign them all to one person, crew or sub.</span></p>
          <ResourcePicker label="Assign all unassigned sections" testId="bulk-picker" resources={data.resources} value={null} onCreated={addResource}
            onAssign={async (rid) => {
              if (!rid) return null;
              for (const sec of unassigned) {
                const err = await assignSection(sec, rid);
                if (err) { void load(); return `${sec.title}: ${err}`; }
              }
              void load();
              return null;
            }} />
        </div>
      )}
      {data.sections.map((s) => (
        <SectionCard key={s.id} s={s} data={data} resName={resName} onSaved={load} onShare={() => setSharing(s)} onCreated={addResource} />
      ))}
      {sharing && <ShareDrawer section={sharing} data={data} resName={resName} onClose={() => setSharing(null)} onChanged={load} />}
    </div>
  );
}

/**
 * Assign (or unassign) one section without touching its text: the save RPC replaces every field, so the
 * last SAVED values are sent back unchanged (never the unsaved edits in an open form).
 */
async function assignSection(s: ScopeSection, resourceId: string | null): Promise<string | null> {
  const body = {
    baseRevision: s.revision, resourceId: resourceId ?? "", summary: resourceId ? "Assignment changed" : "Unassigned",
    workDescription: s.work_description ?? "", technicalInstructions: s.technical_instructions ?? "", installationNotes: s.installation_notes ?? "",
    customerInfo: s.customer_info ?? "", internalNotes: s.internal_notes ?? "",
  };
  const r = await fetch(`/api/scope/${s.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) return "We couldn't reach Built2Bid. Check your connection and try again.";
  if (r.ok) return null;
  const d = await r.json().catch(() => null);
  if (r.status === 409) return "Someone else changed this section first. We reloaded it; pick again.";
  return d?.error?.message ?? "We couldn't save the assignment.";
}

const sectionText = (s: ScopeSection) => ({ workDescription: s.work_description ?? "", technicalInstructions: s.technical_instructions ?? "", installationNotes: s.installation_notes ?? "", customerInfo: s.customer_info ?? "", internalNotes: s.internal_notes ?? "" });

function SectionCard({ s, data, resName, onSaved, onShare, onCreated }: { s: ScopeSection; data: ScopeData; resName: (id: string | null) => string | null; onSaved: () => void; onShare: () => void; onCreated: (r: DirectoryResource) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(() => sectionText(s));
  const savedText = useRef(sectionText(s));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revs, setRevs] = useState<{ revision: number; summary: string | null; created_at: string }[] | null>(null);
  // A newer revision arrived (a save, an assignment, a teammate): take its text, but keep anything typed
  // here and not saved yet, so assigning someone never wipes notes in progress.
  useEffect(() => {
    const next = sectionText(s);
    const before = savedText.current;
    savedText.current = next;
    setF((cur) => {
      const out = { ...next };
      for (const k of Object.keys(next) as (keyof typeof next)[]) if (cur[k] !== before[k]) out[k] = cur[k];
      return out;
    });
  }, [s]);
  const quotes = data.quotesByGroup[s.source_group_id] ?? [];
  const shares = data.shares.filter((x) => x.sectionId === s.id && !x.revokedAt);
  const ro = !data.canManage;

  const save = async (patch?: Partial<typeof f>) => {
    setBusy(true); setErr(null);
    const body = { ...f, ...patch, resourceId: s.resource_id ?? "", baseRevision: s.revision };
    const r = await fetch(`/api/scope/${s.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(r.status === 409 ? "Someone else saved this section. Reloaded the latest version." : d?.error?.message ?? "We couldn't save."); onSaved(); return; }
    onSaved();
  };
  const history = async () => {
    const r = await fetch(`/api/scope/${s.id}/revisions`, { cache: "no-store" });
    const d = await r.json().catch(() => null);
    setRevs(d?.revisions ?? []);
  };
  const area = (k: keyof typeof f, label: string, hint: string, rows = 3) => (
    <div>
      <label className="label" htmlFor={`sc-${s.id}-${k}`}>{label}</label>
      <p className="mb-1 text-[11px] text-muted">{hint}</p>
      <textarea id={`sc-${s.id}-${k}`} rows={rows} className="field text-sm" value={f[k]} disabled={ro} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );

  return (
    <section className="rounded-xl border border-line bg-surface" data-testid="scope-section" data-search-id={s.id}>
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
          <span className="min-w-0"><span className="block truncate font-semibold">{s.title}</span>
            <span className="block text-xs text-muted">{resName(s.resource_id) ? <><Users className="mr-1 inline h-3 w-3" aria-hidden />{resName(s.resource_id)}</> : "Unassigned"}
              {data.photoCount[s.id] ? <> · <Camera className="mx-0.5 inline h-3 w-3" aria-hidden />{data.photoCount[s.id]}</> : null}
              {shares.length ? ` · Shared with ${shares.length}` : ""}</span></span>
        </button>
        {data.canManage && (
          <ResourcePicker label={`Assign ${s.title}`} testId="scope-assign" resources={data.resources} value={s.resource_id} trade={s.trade} disabled={busy} onCreated={onCreated}
            onAssign={async (rid) => { const err = await assignSection(s, rid); onSaved(); return err; }} />
        )}
        {data.canShare && <Button size="sm" variant="secondary" onClick={onShare}><Share2 className="h-4 w-4" aria-hidden /> Share</Button>}
      </div>
      {data.showCosts && quotes.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {quotes.map((q, i) => <span key={i} className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-soft" title="Internal: never shared">{q.vendorName}: {q.itemName}{q.latest ? ` · ${formatCurrency(q.latest)}` : ""}</span>)}
        </div>
      )}
      {open && (
        <div className="space-y-3 border-t border-line p-3">
          {s.approved_scope && <div><p className="label">Approved scope (from the signed proposal)</p><p className="whitespace-pre-line rounded-lg bg-paper p-2 text-sm">{s.approved_scope}</p></div>}
          <div className="grid gap-3 lg:grid-cols-2">
            {area("workDescription", "Work description", "For the crew or subcontractor.")}
            {area("technicalInstructions", "Technical instructions", "Specs, materials, methods.")}
            {area("installationNotes", "Installation notes", "Site access, sequencing, details.")}
            {area("customerInfo", "Customer-facing notes", "Only shown to a subcontractor if you choose to share it.")}
          </div>
          <div className="rounded-lg border border-dashed border-line p-2">
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold"><Lock className="h-3 w-3" aria-hidden /> Internal notes (never shared)</p>
            <textarea aria-label="Internal notes" rows={2} className="field text-sm" value={f.internalNotes} disabled={ro} onChange={(e) => setF({ ...f, internalNotes: e.target.value })} />
          </div>
          {err && <p className="text-sm text-danger" role="alert">{err}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={() => void history()}><History className="h-4 w-4" aria-hidden /> History</Button>
            {!ro && <Button size="sm" onClick={() => void save()} disabled={busy}>Save section</Button>}
          </div>
          {revs && (
            <ul className="space-y-1 text-xs text-muted" aria-label="Section history">
              {revs.length ? revs.map((r) => <li key={r.revision}>Revision {r.revision} · {fmt(r.created_at)}{r.summary ? ` · ${r.summary}` : ""}</li>) : <li>No earlier revisions.</li>}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ShareDrawer({ section, data, resName, onClose, onChanged }: { section: ScopeSection; data: ScopeData; resName: (id: string | null) => string | null; onClose: () => void; onChanged: () => void }) {
  const existing = data.shares.filter((x) => x.sectionId === section.id && !x.revokedAt);
  const [resourceId, setResourceId] = useState(section.resource_id ?? "");
  const [fields, setFields] = useState<ShareField[]>(DEFAULT_SHARE_FIELDS);
  const [pricing, setPricing] = useState<SharePricing>("none");
  const [includePhotos, setIncludePhotos] = useState(false);
  const photoTotal = data.photoCount[section.id] ?? 0;
  const [preview, setPreview] = useState<{ title: string; fields: Record<string, string>; pricing?: SharedPricing; photoCount: number } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const subs = data.resources;

  const call = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/scope/${section.id}/share`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceId: resourceId || null, fields, pricing, includePhotos, ...body }) });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error?.message ?? "We couldn't share this section."); return null; }
    return d;
  };
  const revoke = async (id: string) => {
    setBusy(true);
    await fetch(`/api/scope-shares/${id}`, { method: "DELETE" });
    setBusy(false); onChanged();
  };

  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose(); }} title={`Share: ${section.title}`}>
      <div className="space-y-3 text-sm" data-testid="share-drawer">
        <p className="text-xs text-muted">The subcontractor sees only what you pick, through a private link. Customer details, the address, photos and pricing start off. Your customer price, markup, margin, other sections and internal notes are never included.</p>
        <div><label className="label" htmlFor="sh-res">Share with</label>
          <select id="sh-res" className="field field-sm" value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            <option value="">Anyone with the link</option>{subs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <fieldset data-testid="share-scope-fields">
          <legend className="label">Scope</legend>
          {SHAREABLE_FIELDS.filter((x) => SCOPE_FIELDS.includes(x.key)).map((x) => (
            <label key={x.key} className="flex min-h-9 items-center gap-2 py-0.5">
              <input type="checkbox" className="accent-[var(--color-brand)]" checked={fields.includes(x.key)} onChange={(e) => setFields(e.target.checked ? [...fields, x.key] : fields.filter((k) => k !== x.key))} />{x.label}
            </label>
          ))}
          <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Lock className="h-3 w-3" aria-hidden />Internal notes can&apos;t be shared.</p>
        </fieldset>
        <fieldset data-testid="share-job-fields">
          <legend className="label">Job site and customer</legend>
          {SHAREABLE_FIELDS.filter((x) => JOB_FIELDS.includes(x.key)).map((x) => (
            <label key={x.key} className="flex min-h-9 items-center gap-2 py-0.5">
              <input type="checkbox" className="accent-[var(--color-brand)]" checked={fields.includes(x.key)} onChange={(e) => setFields(e.target.checked ? [...fields, x.key] : fields.filter((k) => k !== x.key))} />{x.label}
            </label>
          ))}
          <label className="flex min-h-9 items-center gap-2 py-0.5">
            <input type="checkbox" className="accent-[var(--color-brand)]" data-testid="share-photos" checked={includePhotos} disabled={!photoTotal} onChange={(e) => setIncludePhotos(e.target.checked)} />
            Photos attached to this section {photoTotal ? `(${photoTotal})` : "(none yet)"}
          </label>
        </fieldset>
        <fieldset data-testid="share-pricing">
          <legend className="label">Pricing</legend>
          {SHARE_PRICING.filter((x) => x.key === "none" || data.showCosts).map((x) => (
            <label key={x.key} className="flex items-start gap-2 py-1">
              <input type="radio" name="sh-pricing" className="mt-0.5 accent-[var(--color-brand)]" value={x.key} checked={pricing === x.key} onChange={() => setPricing(x.key)} />
              <span><span className="font-medium">{x.label}</span><span className="block text-xs text-muted">{x.hint}</span></span>
            </label>
          ))}
          {!data.showCosts && <p className="text-xs text-muted">Sharing pricing needs permission to see subcontractor costs.</p>}
        </fieldset>
        {err && <p className="text-danger" role="alert">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy || !fields.length} onClick={async () => { const d = await call({ preview: true }); if (d) setPreview({ ...d.preview, photoCount: d.photoCount ?? 0 }); }}><Eye className="h-4 w-4" aria-hidden /> Preview</Button>
          <Button size="sm" disabled={busy || !fields.length} onClick={async () => { const d = await call({}); if (d) { setLink(d.url); onChanged(); } }}><Share2 className="h-4 w-4" aria-hidden /> Create share link</Button>
        </div>
        {preview && (
          <div className="rounded-lg border border-line bg-paper p-3" data-testid="share-preview">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">What they&apos;ll see</p>
            <p className="mt-1 font-semibold">{preview.title}</p>
            {Object.entries(preview.fields).map(([k, v]) => <div key={k} className="mt-2"><p className="text-xs font-semibold">{SHAREABLE_FIELDS.find((x) => x.key === k)?.label ?? k}</p><p className="whitespace-pre-line">{v}</p></div>)}
            {preview.pricing && <div className="mt-2"><p className="text-xs font-semibold">{preview.pricing.kind === "approved" ? "Approved amount" : "Proposed budget"}</p><p data-testid="share-preview-pricing">{formatCurrency(preview.pricing.amount)}</p></div>}
            {preview.photoCount > 0 && <p className="mt-2 text-xs">{preview.photoCount} photo{preview.photoCount === 1 ? "" : "s"}</p>}
            {!Object.keys(preview.fields).length && !preview.pricing && <p className="mt-1 text-xs text-muted">The selected fields are empty.</p>}
          </div>
        )}
        {link && (
          <div className="rounded-lg bg-ok-tint p-2 text-xs">
            <p className="font-semibold text-ok">Link ready. Send it to your subcontractor yourself; Built2Bid doesn&apos;t email it.</p>
            <div className="mt-1 flex gap-2"><input readOnly aria-label="Share link" className="field field-sm" value={link} /><Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(link)}><Copy className="h-4 w-4" aria-hidden /> Copy</Button></div>
          </div>
        )}
        {existing.length > 0 && (
          <div>
            <p className="label">Active shares</p>
            <ul className="divide-y divide-line">
              {existing.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-xs"><span className="font-semibold">{resName(x.resourceId) ?? "Link"}</span> · version {x.version}{x.sectionRevision < section.revision ? " · section changed since" : ""} · expires {x.expiresAt.slice(0, 10)}</span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={busy || !fields.length} onClick={async () => { const d = await call({ shareId: x.id }); if (d) onChanged(); }}>Send update</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void revoke(x.id)}>Stop sharing</Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  );
}
