"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Loader2, Send, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { DEFAULT_REPORT_OPTIONS, defaultScopeText, type CustomerReport, type ReportOptions } from "@/lib/schedule/report";
import { REPORT_ASSIGNEE_OPTIONS, type ReportAssignees } from "@/lib/projects/team";
import type { Publication } from "@/lib/schedule/publications";
import type { ScheduleData } from "@/lib/schedule/types";
import { api } from "./client";
import { ReportView } from "./report-view";
import { UpdateDelivery } from "./update-delivery";

const TOGGLES: { key: keyof ReportOptions; label: string; hint?: string }[] = [
  { key: "showProgress", label: "Overall project progress", hint: "Based on % complete you entered, never on days passed." },
  { key: "showTimeline", label: "Schedule timeline" },
  { key: "showCompleted", label: "Completed sections" },
  { key: "showCurrent", label: "Current work" },
  { key: "showUpcoming", label: "Upcoming work" },
  { key: "showTaskDetails", label: "Scheduled line items", hint: "Names and dates of individual items you scheduled." },
  { key: "branding", label: "Company logo and color" },
];

/**
 * Preview Customer Update -> Publish. The preview is built by the server from the saved schedule, so
 * it is exactly what the customer will see. Publishing needs an explicit confirmation and sends nothing.
 */
export function UpdateComposer({ data, lastVersion, customerEmail, contactName, logoUrl, assigneeMode = null }: {
  data: ScheduleData; lastVersion: number | null; customerEmail: string | null; contactName: string | null; logoUrl: string | null;
  /** V4.2: what the report shows about who's doing the work (null when that feature isn't set up). */
  assigneeMode?: ReportAssignees | null;
}) {
  const [aMode, setAMode] = useState<ReportAssignees | null>(assigneeMode);
  const [aErr, setAErr] = useState<string | null>(null);
  const sections = data.tasks.filter((t) => t.kind === "section" && !t.splitFrom).sort((a, b) => a.sortOrder - b.sortOrder);
  const [o, setO] = useState<ReportOptions>(DEFAULT_REPORT_OPTIONS);
  const [preview, setPreview] = useState<{ report: CustomerReport; revision: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<Publication | null>(null);
  const [tab, setTab] = useState<"options" | "preview">("options");
  const [nonce, setNonce] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = `${nonce}:${JSON.stringify(o)}`;
  const loading = !published && loadedKey !== key;
  const seq = useRef(0);

  useEffect(() => {
    if (published) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await api<{ report: CustomerReport; revision: number }>(`/api/schedules/${data.schedule.id}/updates/preview`, { method: "POST", body: JSON.stringify({ options: o }) });
      if (n !== seq.current) return;
      setLoadedKey(key);
      if (!r.ok) { setError(r.message); return; }
      setError(null); setPreview(r.data);
    }, 300);
    return () => clearTimeout(t);
  }, [o, key, data.schedule.id, published]);

  // Any option change needs a fresh confirmation of the new preview.
  const set = (patch: Partial<ReportOptions>) => { setO((x) => ({ ...x, ...patch })); setConfirmed(false); };

  async function publish() {
    if (!preview || !confirmed) return;
    setPublishing(true); setError(null);
    const r = await api<{ publication: Publication }>(`/api/schedules/${data.schedule.id}/updates`, { method: "POST", body: JSON.stringify({ options: o, baseRevision: preview.revision, confirm: true }) });
    setPublishing(false);
    if (!r.ok) { setError(r.message); if (r.code === "stale_revision") { setConfirmed(false); setNonce((x) => x + 1); } return; }
    setPublished(r.data.publication);
    setTab("preview");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const shown = published?.content ?? preview?.report ?? null;
  return (
    <div className="space-y-4" data-testid="update-composer">
      <div>
        <Link href={`/projects/${data.schedule.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Back to schedule</Link>
        <h1 className="mt-2 text-2xl font-extrabold text-navy sm:text-3xl">{published ? `Update ${published.version} published` : "Preview customer update"}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {published ? "This copy is saved exactly as shown. Later schedule changes won't alter it." : <>Your schedule changes stay internal until you publish an update. {lastVersion ? `Your last update was number ${lastVersion}; changes since then are pointed out to your customer.` : "This will be your first update."}</>}
        </p>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {published && <UpdateDelivery scheduleId={data.schedule.id} publication={published} customerEmail={customerEmail} contactName={contactName} onChange={setPublished} canPdf={data.permissions.pdf} />}

      {!published && (
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 lg:hidden" role="tablist" aria-label="Customer update">
          {([["options", "Options", SlidersHorizontal], ["preview", "Preview", Eye]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-md px-4 text-sm font-semibold", tab === k ? "bg-navy text-white" : "text-ink-soft")} data-testid={`tab-${k}`}><Icon className="h-4 w-4" aria-hidden />{label}</button>
          ))}
        </div>
      )}

      <div className={cn("grid gap-4", !published && "lg:grid-cols-[22rem_minmax(0,1fr)]")}>
        {!published && (
          <aside className={cn("space-y-4 lg:block", tab === "options" ? "block" : "hidden")} aria-label="What your customer sees">
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="font-display font-extrabold text-navy">Show your customer</h2>
              <ul className="mt-2 space-y-1">
                {TOGGLES.map((t) => (
                  <li key={t.key}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                      <input type="checkbox" className="mt-1 h-4 w-4" checked={Boolean(o[t.key])} onChange={(e) => set({ [t.key]: e.target.checked } as Partial<ReportOptions>)} data-testid={`opt-${t.key}`} />
                      <span><span className="block text-sm font-semibold">{t.label}</span>{t.hint && <span className="block text-xs text-muted">{t.hint}</span>}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">Never shown: prices, costs, margins, quantities, task weights or your private task notes.</p>
            </section>

            {aMode && (
              <section className="rounded-2xl border border-line bg-surface p-4">
                <label htmlFor="upd-assignees" className="font-display font-extrabold text-navy">Who&apos;s doing the work</label>
                <p className="text-xs text-muted">For sections assigned from Team &amp; Subcontractors. Saved for this project. Phone and email are hidden unless you choose to show them.</p>
                <select id="upd-assignees" className="field mt-2 text-sm" value={aMode} data-testid="opt-assignees" onChange={async (e) => {
                  const mode = e.target.value as ReportAssignees; const prev = aMode;
                  setAMode(mode); setAErr(null);
                  const r = await api(`/api/projects/${data.schedule.id}/report-assignees`, { method: "POST", body: JSON.stringify({ mode }) });
                  if (!r.ok) { setAMode(prev); setAErr(r.message); return; }
                  setConfirmed(false); setNonce((n) => n + 1);
                }}>
                  {REPORT_ASSIGNEE_OPTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
                {aErr && <p role="alert" className="mt-1 text-sm text-danger">{aErr}</p>}
              </section>
            )}

            <section className="rounded-2xl border border-line bg-surface p-4">
              <label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={o.showScope} onChange={(e) => set({ showScope: e.target.checked })} data-testid="opt-showScope" />
                <span><span className="block font-display font-extrabold text-navy">Scope summaries</span><span className="block text-xs text-muted">Off by default. Choose which sections show a scope summary and edit the wording.</span></span>
              </label>
              {o.showScope && (
                <ul className="mt-2 space-y-3">
                  {sections.map((s) => {
                    const on = Object.prototype.hasOwnProperty.call(o.scope, s.id);
                    return (
                      <li key={s.id} className="rounded-lg border border-line p-2">
                        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold">
                          <input type="checkbox" className="h-4 w-4" checked={on} onChange={(e) => {
                            const next = { ...o.scope };
                            if (e.target.checked) next[s.id] = defaultScopeText(data, s); else delete next[s.id];
                            set({ scope: next });
                          }} data-testid={`scope-${s.id}`} />
                          {s.name}
                        </label>
                        {on && <textarea className="field mt-1 text-sm" rows={2} maxLength={600} value={o.scope[s.id]} aria-label={`Scope summary for ${s.name}`} onChange={(e) => set({ scope: { ...o.scope, [s.id]: e.target.value } })} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-line bg-surface p-4">
              <label htmlFor="upd-notes" className="font-display font-extrabold text-navy">Progress notes (optional)</label>
              <p className="text-xs text-muted">Shown to your customer exactly as written.</p>
              <textarea id="upd-notes" className="field mt-2 text-sm" rows={4} maxLength={2000} value={o.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Cabinets arrive Tuesday; we'll start installing Wednesday morning." data-testid="opt-notes" />
            </section>
          </aside>
        )}

        <div className={cn("min-w-0 space-y-4 lg:block", !published && tab !== "preview" ? "hidden" : "block")}>
          {!published && (
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
              <Eye className="h-4 w-4" aria-hidden /> This is exactly what your customer will see.
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-label="Updating preview" />}
            </p>
          )}
          {shown ? <div className={cn(loading && !published && "opacity-60 transition")}><ReportView r={shown} logoUrl={logoUrl} version={published?.version ?? (lastVersion ?? 0) + 1} /></div>
            : <div className="h-64 animate-pulse rounded-2xl bg-surface" />}

          {!published && (
            <section className="sticky bottom-2 z-10 space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-lg" aria-label="Publish">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!preview || loading} data-testid="confirm-preview" />
                <span className="text-sm"><span className="font-semibold">I reviewed this preview.</span> Publishing saves this exact version as update {(lastVersion ?? 0) + 1}. It doesn&apos;t send anything: you choose how to share it next.</span>
              </label>
              <div className="flex justify-end">
                <Button loading={publishing} onClick={publish} disabled={!confirmed || !preview || loading || publishing} data-testid="publish-update">{!publishing && <Send className="h-4 w-4" aria-hidden />} Publish update</Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
