"use client";
/**
 * The personalized dashboard (V6.6). Normal use: a plain grid of widgets, nothing moves. "Customize Dashboard"
 * opens an editing mode with visible handles: add from the library, remove, drag (mouse, touch or pen on the
 * handle; arrow keys on the focused handle; or the Move buttons), resize, configure each widget, pick a template,
 * restore defaults, and (primary Enterprise account holder) save as a company default.
 *
 * Changes autosave (debounced) with visible status. A failed save keeps the layout on this device and retries;
 * a newer layout from another tab or device is never silently overwritten. Widget content is rendered on the
 * server; after a save that adds or reconfigures a widget the page refreshes to fetch just those widgets' data.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical, LayoutTemplate, Lock, Plus, RotateCcw, Settings2, Sparkles, Trash2, TriangleAlert, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { FinDialog } from "@/components/financials/fin-dialog";
import { ModeToggle } from "@/components/financials/customize-dashboard";
import { cn } from "@/lib/cn";
import { CHART_OPTIONS, GROUPS, GROUP_LABELS, WIDGETS, instanceTitle, widgetDef, type Option, type WidgetDef } from "@/lib/dashboard/registry";
import { DATASET_INFO, chartTypesFor, isDataset } from "@/lib/dashboard/charts";
import { add as addWidget, configure, fitSize, move, newInstance, remove, resize, type DashboardMode, type WidgetInstance } from "@/lib/dashboard/schema";
import { TEMPLATES, TEMPLATE_KEYS, INTERESTS, availableInterests, buildTemplate, suggestLayout, type InterestKey, type TemplateKey } from "@/lib/dashboard/templates";
import type { DashboardAccess } from "@/lib/dashboard/access";
import { phoneHalfWidth } from "@/lib/dashboard/phone";

export interface BuilderProps {
  mode: DashboardMode;
  accountantModeAllowed: boolean;
  layout: { template: string | null; widgets: WidgetInstance[] };
  revision: number | null;
  origin: "mine" | "company" | "template";
  ready: boolean;
  isCompanyOwner: boolean;
  /** Server-rendered bodies of the widgets the viewer may see, by instance id. */
  nodes: Record<string, ReactNode>;
  /** Widget types the viewer may add (already filtered by their access). */
  allowedTypes: string[];
  /** Quick actions the viewer may use. */
  allowedActions: string[];
  /** The viewer's access (presentation only: templates and suggestions keep just the widgets they may see). */
  access: DashboardAccess;
  options: { jobs: Option[]; trades: Option[] };
  /** Show the optional "Set up my dashboard" prompt (no saved layout yet). */
  offerSetup: boolean;
  /** Pick one of these in the setup dialog first. */
  defaultTemplate: TemplateKey;
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string } | { kind: "conflict" } | { kind: "offline"; message: string };

const SPAN_LG = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" } as const;
const SPAN_MD = { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-2", 4: "md:col-span-2" } as const;
const PENDING_KEY = (m: DashboardMode) => `b2b.dashboard.pending.${m}`;
const WIDTH_LABEL = { 1: "Small", 2: "Medium", 3: "Large", 4: "Full width" } as const;

// "Set Up My Dashboard" nudge, dismissed on this device per mode.
const OFFER_KEY = (m: DashboardMode) => `b2b.dashboard.setupOffer.hidden.${m}`;
const offerListeners = new Set<() => void>();
const subscribeOffer = (cb: () => void) => { offerListeners.add(cb); return () => { offerListeners.delete(cb); }; };
function offerDismissed(mode: DashboardMode) { try { return localStorage.getItem(OFFER_KEY(mode)) === "1"; } catch { return false; } }

function readPending(mode: DashboardMode): { widgets: WidgetInstance[]; template: string | null; base: number | null; at: number } | null {
  try { const v = localStorage.getItem(PENDING_KEY(mode)); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writePending(mode: DashboardMode, v: object | null) {
  try { if (v) localStorage.setItem(PENDING_KEY(mode), JSON.stringify(v)); else localStorage.removeItem(PENDING_KEY(mode)); } catch { /* storage blocked: the in-memory copy still retries */ }
}

export function DashboardBuilder(p: BuilderProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [widgets, setWidgets] = useState(p.layout.widgets);
  const [template, setTemplate] = useState(p.layout.template);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [library, setLibrary] = useState(false);
  const [setup, setSetup] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [recovered, setRecovered] = useState<ReturnType<typeof readPending>>(null);
  const [announce, setAnnounce] = useState("");
  const offerHidden = useSyncExternalStore(subscribeOffer, () => offerDismissed(p.mode), () => false);
  const hideOffer = () => { try { localStorage.setItem(OFFER_KEY(p.mode), "1"); } catch { /* storage blocked: hidden for this visit only */ } offerListeners.forEach((f) => f()); };
  const revision = useRef(p.revision);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const timer = useRef<number | null>(null);
  const retry = useRef(0);
  const latest = useRef({ widgets, template });
  const needsRefresh = useRef(false);
  const saveRef = useRef<(o?: { force?: boolean }) => Promise<void>>(async () => {});
  /** Something changed locally that the server doesn't have yet (mirrors the refs for rendering). */
  const [unsaved, setUnsaved] = useState(false);
  useEffect(() => { latest.current = { widgets, template }; }, [widgets, template]);

  // A new server layout (after a refresh, mode switch or restore) replaces the local copy when nothing is pending.
  const serverSig = `${p.mode}|${p.revision}|${p.origin}|${JSON.stringify(p.layout.widgets)}`;
  const [seenSig, setSeenSig] = useState(serverSig);
  if (serverSig !== seenSig && !unsaved) {
    setSeenSig(serverSig); setWidgets(p.layout.widgets); setTemplate(p.layout.template);
  }
  useEffect(() => { if (!dirty.current && !inFlight.current) revision.current = p.revision; }, [p.revision]);

  // Unsaved changes from an earlier visit (a save that failed): offer them back instead of losing them.
  useEffect(() => {
    const pending = readPending(p.mode);
    // Browser storage only exists after hydration, so this has to run in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of this device's unsaved copy
    if (pending && pending.base === p.revision && JSON.stringify(pending.widgets) !== JSON.stringify(p.layout.widgets)) setRecovered(pending);
    else if (pending) writePending(p.mode, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mode/revision
  }, [p.mode, p.revision]);

  const save = useCallback(async (opts: { force?: boolean; source?: "user" | "setup" | "template" } = {}) => {
    if (!p.ready) return;
    if (inFlight.current) { dirty.current = true; return; }
    inFlight.current = true; dirty.current = false;
    const snap = latest.current;
    setStatus({ kind: "saving" });
    writePending(p.mode, { widgets: snap.widgets, template: snap.template, base: revision.current, at: Date.now() });
    try {
      const res = await fetch("/api/dashboard/layout", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save", mode: p.mode, layout: { template: snap.template, widgets: snap.widgets }, expectedRevision: revision.current, force: Boolean(opts.force), source: opts.source ?? "user" }) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 409) { setStatus({ kind: "conflict" }); return; }
      if (!res.ok) throw Object.assign(new Error(out?.error?.message ?? "Couldn't save."), { status: res.status });
      revision.current = out.revision;
      retry.current = 0;
      if (!dirty.current) { writePending(p.mode, null); setUnsaved(false); }
      setStatus({ kind: "saved" });
      if (needsRefresh.current && !dirty.current) { needsRefresh.current = false; router.refresh(); }
    } catch (e) {
      const st = (e as { status?: number }).status;
      const message = (e as Error).message || "Couldn't save.";
      if (st && st < 500 && st !== 429) { setStatus({ kind: "error", message }); return; }
      // Network or server trouble: keep the layout on this device and try again with backoff.
      setStatus({ kind: "offline", message: "Couldn't save. Your changes are kept on this device and will retry." });
      const wait = [3000, 10000, 30000, 60000][Math.min(retry.current++, 3)];
      dirty.current = true;
      window.setTimeout(() => { if (dirty.current) void saveRef.current(); }, wait);
    } finally {
      inFlight.current = false;
      if (dirty.current && retry.current === 0) void saveRef.current();
    }
  }, [p.mode, p.ready, router]);
  useEffect(() => { saveRef.current = save; }, [save]);

  const schedule = useCallback((refresh = false) => {
    dirty.current = true;
    setUnsaved(true);
    if (refresh) needsRefresh.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; void save(); }, 700);
  }, [save]);

  // Warn before leaving with an unsaved change.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.current || inFlight.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const change = (next: WidgetInstance[], opts: { refresh?: boolean; say?: string } = {}) => {
    setWidgets(next);
    if (opts.say) setAnnounce(opts.say);
    schedule(opts.refresh);
  };

  const flushNow = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; void save(); } };

  const titleOf = (w: WidgetInstance) => instanceTitle(w.type, w.settings);
  const allowedSet = useMemo(() => new Set(p.allowedTypes), [p.allowedTypes]);
  const counts = (type: string) => widgets.filter((w) => w.type === type).length;

  const moveBy = (id: string, delta: number) => {
    const i = widgets.findIndex((w) => w.id === id);
    const to = i + delta;
    if (i < 0 || to < 0 || to >= widgets.length) return;
    change(move(widgets, id, to), { say: `${titleOf(widgets[i])} moved to position ${to + 1} of ${widgets.length}.` });
  };

  // ---- Pointer drag on the handle -----------------------------------------------------------------------------
  const cells = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{ id: string; pointerId: number; start: WidgetInstance[] } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const onHandleDown = (id: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, pointerId: e.pointerId, start: widgets };
    setDragId(id);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    for (const [k, el] of cells.current) {
      if (k === d.id) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
      setWidgets((cur) => move(cur, d.id, cur.findIndex((w) => w.id === k)));
      break;
    }
  };
  const endDrag = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    setDragId(null);
    if (!d) return;
    if (!commit) { setWidgets(d.start); return; }
    const cur = latest.current.widgets;
    if (cur.map((w) => w.id).join() !== d.start.map((w) => w.id).join()) {
      setAnnounce(`${titleOf(cur.find((w) => w.id === d.id)!)} moved to position ${cur.findIndex((w) => w.id === d.id) + 1}.`);
      schedule();
    }
  };
  useEffect(() => {
    if (!dragId) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") endDrag(false); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- endDrag reads refs
  }, [dragId]);

  const onHandleKey = (id: string) => (e: React.KeyboardEvent) => {
    if (["ArrowUp", "ArrowLeft"].includes(e.key)) { e.preventDefault(); moveBy(id, -1); }
    else if (["ArrowDown", "ArrowRight"].includes(e.key)) { e.preventDefault(); moveBy(id, 1); }
    else if (e.key === "Home") { e.preventDefault(); change(move(widgets, id, 0), { say: `${titleOf(widgets.find((w) => w.id === id)!)} moved to the top.` }); }
    else if (e.key === "End") { e.preventDefault(); change(move(widgets, id, widgets.length - 1), { say: `${titleOf(widgets.find((w) => w.id === id)!)} moved to the end.` }); }
  };
  // Keep keyboard focus on the moved handle.
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const focusAfter = useRef<string | null>(null);
  useEffect(() => { if (focusAfter.current) { handles.current.get(focusAfter.current)?.focus(); focusAfter.current = null; } }, [widgets]);

  // ---- Actions ---------------------------------------------------------------------------------------------------
  const addType = (type: string) => {
    const def = widgetDef(type);
    if (!def) return;
    const spec = def.settings[0];
    const settings = type === "quick_actions" && spec?.kind === "multi" ? { actions: spec.default.filter((a) => p.allowedActions.includes(a)) } : undefined;
    const inst = newInstance(type, settings);
    change(addWidget(widgets, inst), { refresh: true, say: `${def.title} added at the end.` });
    setLibrary(false);
  };
  const applyLayout = (next: WidgetInstance[], tmpl: string | null, say: string) => {
    setTemplate(tmpl);
    latest.current = { widgets: next, template: tmpl };
    change(next, { refresh: true, say });
  };
  const restore = async () => {
    if (!p.ready) return;
    if (timer.current) window.clearTimeout(timer.current);
    dirty.current = false;
    setStatus({ kind: "saving" });
    const res = await fetch("/api/dashboard/layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reset", mode: p.mode }) });
    if (!res.ok) { setStatus({ kind: "error", message: "Couldn't restore the defaults. Try again." }); return; }
    writePending(p.mode, null);
    setUnsaved(false);
    revision.current = null;
    setStatus({ kind: "saved" });
    setAnnounce("Default layout restored.");
    router.refresh();
  };
  const done = () => { flushNow(); setEditing(false); setSettingsFor(null); if (needsRefresh.current && !dirty.current && !inFlight.current) { needsRefresh.current = false; router.refresh(); } };

  const shown = widgets.filter((w) => allowedSet.has(w.type) || p.nodes[w.id] !== undefined);
  const compact = phoneHalfWidth(shown, editing);
  const hidden = widgets.filter((w) => !shown.includes(w));
  const settingsInst = settingsFor ? widgets.find((w) => w.id === settingsFor) ?? null : null;

  return (
    <div className="space-y-4" data-testid="dashboard-builder" data-editing={editing || undefined} data-mode={p.mode}>
      {/* Phones: title and subtitle get the full width with Customize beside them; the mode switch is its own
          full-width row. Wide screens (xl): one row (title, mode switch, Customize). The heading is never squeezed. */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 xl:flex xl:items-end" data-testid="dash-header">
        <div className="min-w-0 xl:flex-1">
          <h1 className="text-2xl font-extrabold sm:text-3xl">Home</h1>
          <p className="text-sm text-ink-soft sm:text-base" data-testid="dash-subtitle">{editing ? "Drag the handles, resize, add or remove widgets. Changes save automatically." : "Your business at a glance."}</p>
        </div>
        {!editing ? (
          <Button variant="secondary" onClick={() => setEditing(true)} className="min-w-11 px-3 max-[359px]:px-0 sm:px-4 xl:order-last" data-testid="dash-customize"><Settings2 className="h-4 w-4" aria-hidden /><span className="max-[359px]:sr-only">Customize<span className="max-sm:sr-only"> Dashboard</span></span></Button>
        ) : (
          <Button onClick={done} className="px-3 sm:px-4 xl:order-last" data-testid="dash-done"><Check className="h-4 w-4" aria-hidden /><span>Done<span className="max-sm:sr-only"> Editing</span></span></Button>
        )}
        {p.accountantModeAllowed && !editing && <ModeToggle mode={p.mode} className="col-span-2 grid w-full grid-cols-2 sm:inline-flex sm:w-auto sm:justify-self-start xl:shrink-0" />}
      </header>

      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {!p.ready && editing && <Notice tone="warn" title="Saving isn't on yet">Your dashboard can be rearranged once a short database update is applied. Nothing changes until then.</Notice>}
      {recovered && (
        <Notice tone="warn" title="You have unsaved dashboard changes">
          <p>A change from {new Date(recovered.at).toLocaleString()} didn&apos;t save.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setRecovered(null); applyLayout(recovered.widgets, recovered.template, "Unsaved changes restored."); }}>Restore them</Button>
            <Button size="sm" variant="ghost" onClick={() => { writePending(p.mode, null); setRecovered(null); }}>Discard</Button>
          </div>
        </Notice>
      )}
      {editing && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 p-2 shadow-card backdrop-blur" role="toolbar" aria-label="Customize dashboard" data-testid="dash-toolbar">
          <Button size="sm" onClick={() => setLibrary(true)} data-testid="dash-add"><Plus className="h-4 w-4" aria-hidden /> Add widget</Button>
          <Button size="sm" variant="secondary" onClick={() => setSetup(true)}><LayoutTemplate className="h-4 w-4" aria-hidden /> Templates</Button>
          <Button size="sm" variant="secondary" onClick={restore} disabled={!p.ready} data-testid="dash-restore"><RotateCcw className="h-4 w-4" aria-hidden /> Restore default layout</Button>
          {p.isCompanyOwner && <Button size="sm" variant="ghost" onClick={() => setCompanyOpen(true)} data-testid="dash-company"><Users className="h-4 w-4" aria-hidden /> Company defaults</Button>}
          <SaveStatus status={status} onRetry={() => void save()} onKeepMine={() => void save({ force: true })} onLoadLatest={() => { dirty.current = false; setUnsaved(false); writePending(p.mode, null); setStatus({ kind: "idle" }); router.refresh(); }} />
        </div>
      )}

      {widgets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <p className="font-semibold">Your dashboard is empty.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button onClick={() => { setEditing(true); setLibrary(true); }}><Plus className="h-4 w-4" aria-hidden /> Add widget</Button>
            <Button variant="secondary" onClick={() => setSetup(true)}>Set Up My Dashboard</Button>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:[grid-auto-rows:minmax(9.5rem,auto)] lg:grid-cols-4" aria-label="Dashboard widgets" data-testid="dash-grid">
          {shown.map((w, i) => {
            const def = widgetDef(w.type);
            const node = p.nodes[w.id];
            const title = titleOf(w);
            const half = compact.has(w.id);
            return (
              <li key={w.id} ref={(el) => { if (el) cells.current.set(w.id, el); else cells.current.delete(w.id); }}
                className={cn("dash-cell relative min-w-0", half ? "col-span-1" : "col-span-2", SPAN_MD[w.w], SPAN_LG[w.w], w.h === 2 && "md:row-span-2", dragId === w.id && "z-10 scale-[1.02] rounded-xl shadow-lg ring-2 ring-accent", editing && "rounded-xl ring-1 ring-line")}
                data-widget={w.type} data-widget-id={w.id} data-w={w.w} data-h={w.h} data-compact={half || undefined}>
                {editing && (
                  <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-1 rounded-t-xl border-b border-line bg-surface/95 p-1 backdrop-blur">
                    <button type="button" ref={(el) => { if (el) handles.current.set(w.id, el); else handles.current.delete(w.id); }}
                      className="grid min-h-10 min-w-10 cursor-grab touch-none place-items-center rounded-lg text-ink-soft hover:bg-black/5 focus-visible:outline-2 active:cursor-grabbing"
                      aria-label={`Move ${title}. Position ${i + 1} of ${shown.length}. Use arrow keys to move.`} aria-roledescription="drag handle"
                      onPointerDown={onHandleDown(w.id)} onPointerMove={onHandleMove} onPointerUp={() => endDrag(true)} onPointerCancel={() => endDrag(false)}
                      onKeyDown={(e) => { focusAfter.current = w.id; onHandleKey(w.id)(e); }} data-testid="dash-handle">
                      <GripVertical className="h-5 w-5" aria-hidden />
                    </button>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
                    <IconBtn label={`Move ${title} earlier`} onClick={() => { focusAfter.current = null; moveBy(w.id, -1); }} disabled={i === 0}><ArrowUp className="h-4 w-4" aria-hidden /></IconBtn>
                    <IconBtn label={`Move ${title} later`} onClick={() => moveBy(w.id, 1)} disabled={i === shown.length - 1}><ArrowDown className="h-4 w-4" aria-hidden /></IconBtn>
                    <IconBtn label={`Settings and size for ${title}`} onClick={() => setSettingsFor(w.id)} testId="dash-settings"><Settings2 className="h-4 w-4" aria-hidden /></IconBtn>
                    <IconBtn label={`Remove ${title}`} onClick={() => change(remove(widgets, w.id), { say: `${title} removed.` })} testId="dash-remove"><Trash2 className="h-4 w-4" aria-hidden /></IconBtn>
                  </div>
                )}
                <div className={cn("h-full", editing && "pointer-events-none select-none pt-12 opacity-90")} inert={editing || undefined}>
                  {node ?? <div className="h-full animate-pulse rounded-xl border border-line bg-surface p-4"><p className="text-sm font-semibold text-ink-soft">{def?.title ?? title}</p><p className="mt-2 text-xs text-muted">{p.ready ? "Loading…" : "Shows once saved."}</p></div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && hidden.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-3 text-sm" aria-label="Hidden widgets" data-testid="dash-hidden">
          <p className="flex items-center gap-1.5 font-semibold"><Lock className="h-4 w-4" aria-hidden /> Kept in your layout but not shown</p>
          <p className="text-xs text-muted">You don&apos;t have access to these right now, or they were retired. Nothing from them is shown. They come back if access returns.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {hidden.map((w) => (
              <li key={w.id} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1">
                {WIDGETS[w.type]?.title ?? "Retired widget"}
                <IconBtn label="Remove from layout" onClick={() => change(remove(widgets, w.id))}><X className="h-3.5 w-3.5" aria-hidden /></IconBtn>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The optional "make it yours" nudge sits under the widgets so the numbers come first; it can be dismissed
          on this device, and Customize Dashboard (top) and Templates stay available either way. */}
      {!editing && p.offerSetup && widgets.length > 0 && !offerHidden && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-line bg-surface py-2 pl-3 pr-1 text-sm" data-testid="dash-setup-offer">
          <Sparkles className="h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
          <span className="min-w-0 flex-1">{p.origin === "company" ? "This is your company's starting dashboard." : "This is a starting dashboard."} Make it yours in a minute, or keep it.</span>
          <Button size="sm" variant="secondary" className="min-h-11 shrink-0 sm:min-h-9" onClick={() => setSetup(true)} data-testid="dash-setup-open"><span>Set Up<span className="max-sm:sr-only"> My Dashboard</span></span></Button>
          <IconBtn label="Hide this suggestion" onClick={hideOffer} testId="dash-setup-dismiss"><X className="h-4 w-4" aria-hidden /></IconBtn>
        </div>
      )}

      <LibraryDialog open={library} onOpenChange={setLibrary} allowed={p.allowedTypes} counts={counts} onAdd={addType} />
      <SettingsDialog inst={settingsInst} onClose={() => setSettingsFor(null)} options={p.options} allowedActions={p.allowedActions}
        onSize={(w, h) => settingsInst && change(resize(widgets, settingsInst.id, w, h), { say: `${titleOf(settingsInst)} resized to ${WIDTH_LABEL[fitSize(settingsInst.type, w, h).w]}.` })}
        onChange={(patch) => settingsInst && change(configure(widgets, settingsInst.id, patch), { refresh: true })} />
      <SetupDialog open={setup} onOpenChange={setSetup} access={p.access} current={template} defaultTemplate={p.defaultTemplate} ready={p.ready}
        onApply={(next, tmpl, source) => { setSetup(false); setEditing(true); applyLayout(next, tmpl, "New layout applied."); void source; }} />
      {p.isCompanyOwner && <CompanyDialog open={companyOpen} onOpenChange={setCompanyOpen} mode={p.mode} layout={{ template, widgets }} />}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children, testId }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; testId?: string }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} data-testid={testId} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-ink-soft hover:bg-black/5 focus-visible:outline-2 disabled:opacity-40">{children}</button>;
}

function SaveStatus({ status, onRetry, onKeepMine, onLoadLatest }: { status: Status; onRetry: () => void; onKeepMine: () => void; onLoadLatest: () => void }) {
  const base = "ml-auto flex flex-wrap items-center gap-2 text-xs";
  if (status.kind === "saving") return <span className={cn(base, "text-muted")} data-testid="dash-status" data-status="saving">Saving…</span>;
  if (status.kind === "saved") return <span className={cn(base, "text-ok")} data-testid="dash-status" data-status="saved"><Check className="h-3.5 w-3.5" aria-hidden /> Saved</span>;
  if (status.kind === "conflict") return (
    <span className={cn(base, "text-warn")} data-testid="dash-status" data-status="conflict"><TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Changed on another device or tab.
      <Button size="sm" variant="secondary" onClick={onLoadLatest}>Load that version</Button><Button size="sm" variant="ghost" onClick={onKeepMine}>Keep mine</Button></span>
  );
  if (status.kind === "error" || status.kind === "offline") return (
    <span className={cn(base, "text-danger")} data-testid="dash-status" data-status="error"><TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {status.message}<Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button></span>
  );
  return <span className={cn(base, "text-muted")} data-testid="dash-status" data-status="idle">Changes save automatically</span>;
}

function LibraryDialog({ open, onOpenChange, allowed, counts, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; allowed: string[]; counts: (t: string) => number; onAdd: (t: string) => void }) {
  const [q, setQ] = useState("");
  const defs = allowed.map((t) => WIDGETS[t]).filter(Boolean) as WidgetDef[];
  const match = (d: WidgetDef) => !q.trim() || `${d.title} ${d.description}`.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title="Add a widget" description="Only widgets for features you can use are listed." wide>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search widgets" aria-label="Search widgets" className="input mb-3 w-full" />
      <div className="space-y-4" data-testid="dash-library">
        {GROUPS.map((g) => {
          const list = defs.filter((d) => d.group === g && match(d));
          if (!list.length) return null;
          return (
            <section key={g} aria-label={GROUP_LABELS[g]}>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{GROUP_LABELS[g]}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {list.map((d) => {
                  const added = counts(d.type) > 0 && !d.multiple;
                  return (
                    <li key={d.type}>
                      <button type="button" disabled={added} onClick={() => onAdd(d.type)} data-testid={`dash-lib-${d.type}`}
                        className="flex min-h-14 w-full items-start gap-2 rounded-lg border border-line p-2.5 text-left hover:border-accent focus-visible:outline-2 disabled:opacity-50">
                        <Plus className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
                        <span className="min-w-0"><span className="block text-sm font-semibold">{d.title}{added && <span className="font-normal text-muted"> · on your dashboard</span>}{d.multiple && counts(d.type) > 0 && <span className="font-normal text-muted"> · {counts(d.type)} added</span>}</span><span className="block text-xs text-muted">{d.description}</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </FinDialog>
  );
}

function SettingsDialog({ inst, onClose, onChange, onSize, options, allowedActions }: { inst: WidgetInstance | null; onClose: () => void; onChange: (p: Record<string, unknown>) => void; onSize: (w: number, h: number) => void; options: { jobs: Option[]; trades: Option[] }; allowedActions: string[] }) {
  const def = inst ? widgetDef(inst.type) : undefined;
  if (!inst || !def) return null;
  const s = inst.settings;
  const widths = ([1, 2, 3, 4] as const).filter((w) => w >= (def.size.minW ?? 1) && w <= (def.size.maxW ?? 4));
  const heights = ([1, 2] as const).filter((h) => h <= (def.size.maxH ?? def.size.h));
  const select = (key: string, label: string, opts: readonly { value: string; label: string }[], value: string) => (
    <label key={key} className="block"><span className="label">{label}</span>
      <select className="input w-full" value={value} onChange={(e) => onChange({ [key]: e.target.value })} data-testid={`dash-set-${key}`}>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  return (
    <FinDialog open onOpenChange={(o) => { if (!o) onClose(); }} title={`${instanceTitle(inst.type, s)} settings`} description="Saved for this widget only.">
      <div className="space-y-4" data-testid="dash-settings-panel">
        <fieldset><legend className="label">Size</legend>
          <div className="flex flex-wrap gap-2">
            {widths.map((w) => <button key={w} type="button" aria-pressed={inst.w === w} onClick={() => onSize(w, inst.h)} data-testid={`dash-width-${w}`} className={cn("min-h-10 rounded-lg border px-3 text-sm", inst.w === w ? "border-accent bg-accent/10 font-semibold" : "border-line")}>{WIDTH_LABEL[w]}</button>)}
          </div>
          {heights.length > 1 && <div className="mt-2 flex flex-wrap gap-2">
            {heights.map((h) => <button key={h} type="button" aria-pressed={inst.h === h} onClick={() => onSize(inst.w, h)} data-testid={`dash-height-${h}`} className={cn("min-h-10 rounded-lg border px-3 text-sm", inst.h === h ? "border-accent bg-accent/10 font-semibold" : "border-line")}>{h === 1 ? "Short" : "Tall"}</button>)}
          </div>}
          <p className="mt-1 text-xs text-muted">Phones show one widget per row; your desktop sizes stay as set.</p>
        </fieldset>
        {def.settings.map((spec) => {
          if (spec.kind === "select") return select(spec.key, spec.label, spec.options, String(s[spec.key] ?? spec.default));
          if (spec.kind === "multi") {
            const cur = (s[spec.key] as string[]) ?? [];
            const opts = spec.key === "actions" ? spec.options.filter((o) => allowedActions.includes(o.value)) : spec.options;
            return (
              <fieldset key={spec.key}><legend className="label">{spec.label}{spec.max ? ` (up to ${spec.max})` : ""}</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {opts.map((o) => {
                    const on = cur.includes(o.value);
                    return <label key={o.value} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-2 text-sm"><input type="checkbox" checked={on} disabled={!on && spec.max !== undefined && cur.length >= spec.max} onChange={() => onChange({ [spec.key]: on ? cur.filter((x) => x !== o.value) : [...cur, o.value] })} />{o.label}</label>;
                  })}
                </div>
              </fieldset>
            );
          }
          if (spec.kind === "chart") {
            const dataset = isDataset(s.dataset) ? s.dataset : "expenses";
            const info = DATASET_INFO[dataset];
            const cats = (s.categories as string[] | null) ?? null;
            return (
              <div key="chart" className="space-y-3">
                <label className="block"><span className="label">Data</span>
                  <select className="input w-full" value={dataset} data-testid="dash-set-dataset"
                    onChange={(e) => { const d = e.target.value as typeof dataset; onChange({ dataset: d, chart: chartTypesFor(d).includes(s.chart as never) ? s.chart : chartTypesFor(d)[0], categories: null }); }}>
                    {CHART_OPTIONS.datasets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <span className="mt-1 block text-xs text-muted">{info.hint}</span>
                </label>
                <fieldset><legend className="label">Chart type</legend>
                  <div className="flex flex-wrap gap-2">
                    {CHART_OPTIONS.types(dataset).map((o) => <button key={o.value} type="button" aria-pressed={s.chart === o.value} onClick={() => onChange({ chart: o.value })} data-testid={`dash-type-${o.value}`} className={cn("min-h-10 rounded-lg border px-3 text-sm", s.chart === o.value ? "border-accent bg-accent/10 font-semibold" : "border-line")}>{o.label}</button>)}
                  </div>
                  <span className="mt-1 block text-xs text-muted">{info.shape === "series" ? "Amounts over time: shown by month, quarter or year." : "Parts of one total: a line chart isn't offered because categories aren't a timeline."}</span>
                </fieldset>
                {select("period", "Date range", CHART_OPTIONS.periods, String(s.period))}
                {info.source === "pl" && select("basis", "Basis", CHART_OPTIONS.bases, String(s.basis))}
                {info.filters && options.jobs.length > 0 && select("job", "Project", [{ value: "", label: "All projects" }, ...options.jobs], String(s.job ?? ""))}
                {info.filters && options.trades.length > 0 && select("trade", "Trade", [{ value: "", label: "All trades" }, ...options.trades], String(s.trade ?? ""))}
                {info.categories && (
                  <fieldset data-testid="dash-categories"><legend className="label">Categories</legend>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {CHART_OPTIONS.categories.map((o) => {
                        const on = cats === null || cats.includes(o.value);
                        const all = CHART_OPTIONS.categories.map((c) => c.value);
                        return <label key={o.value} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-2 text-sm"><input type="checkbox" checked={on} onChange={() => {
                          const base = cats ?? all;
                          const next = on ? base.filter((x) => x !== o.value) : [...base, o.value];
                          onChange({ categories: next.length === all.length ? null : next });
                        }} />{o.label}</label>;
                      })}
                    </div>
                    <span className="mt-1 block text-xs text-muted">When some are off, the chart says totals include only the selected categories.</span>
                  </fieldset>
                )}
              </div>
            );
          }
          return null;
        })}
        <Button onClick={onClose} className="w-full sm:w-auto">Done</Button>
      </div>
    </FinDialog>
  );
}

function SetupDialog({ open, onOpenChange, access, current, defaultTemplate, ready, onApply }: {
  open: boolean; onOpenChange: (o: boolean) => void; access: DashboardAccess;
  current: string | null; defaultTemplate: TemplateKey; ready: boolean; onApply: (w: WidgetInstance[], template: string, source: "setup" | "template") => void;
}) {
  const [picked, setPicked] = useState<InterestKey[]>([]);
  const interests = useMemo(() => availableInterests(access), [access]);
  const templates = useMemo(() => Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, buildTemplate(k, access).widgets])) as Record<TemplateKey, WidgetInstance[]>, [access]);
  const suggestion = useMemo(() => {
    if (!picked.length) return null;
    const l = suggestLayout(picked, access);
    return { template: l.template ?? "simple", widgets: l.widgets };
  }, [picked, access]);
  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title="Set up my dashboard" description="Optional. Pick what matters most and we'll suggest a layout, or start from a template. You can change anything later." wide>
      <div className="space-y-5" data-testid="dash-setup">
        {!ready && <Notice tone="warn">Layouts can be saved once a short database update is applied.</Notice>}
        {interests.length > 0 && (
          <fieldset><legend className="label">What matters most to you?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {interests.map((k) => {
                const on = picked.includes(k);
                return <label key={k} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm"><input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== k) : [...picked, k])} data-testid={`dash-interest-${k}`} />{INTERESTS[k].label}</label>;
              })}
            </div>
            {suggestion && (
              <div className="mt-3 rounded-lg border border-line p-3 text-sm">
                <p className="font-semibold">Suggested: {suggestion.widgets.length} widgets</p>
                <p className="text-xs text-muted">{suggestion.widgets.map((w) => instanceTitle(w.type, w.settings)).join(" · ")}</p>
                <Button size="sm" className="mt-2" onClick={() => onApply(suggestion.widgets, suggestion.template, "setup")} data-testid="dash-setup-apply">Use this layout</Button>
              </div>
            )}
          </fieldset>
        )}
        <fieldset><legend className="label">Or start from a template</legend>
          <ul className="grid gap-2 sm:grid-cols-3">
            {TEMPLATE_KEYS.filter((k) => templates[k].length > 0).map((k) => (
              <li key={k}>
                <button type="button" onClick={() => onApply(templates[k], k, "template")} data-testid={`dash-template-${k}`}
                  className={cn("flex h-full w-full flex-col items-start gap-1 rounded-lg border p-3 text-left hover:border-accent focus-visible:outline-2", current === k ? "border-accent" : "border-line")}>
                  <span className="text-sm font-semibold">{TEMPLATES[k].label}{k === defaultTemplate && <span className="font-normal text-muted"> · suggested</span>}</span>
                  <span className="text-xs text-muted">{TEMPLATES[k].audience}</span>
                  <span className="text-xs text-ink-soft">{TEMPLATES[k].description}</span>
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
        <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="dash-setup-skip">Skip for now</Button>
      </div>
    </FinDialog>
  );
}

function CompanyDialog({ open, onOpenChange, mode, layout }: { open: boolean; onOpenChange: (o: boolean) => void; mode: DashboardMode; layout: { template: string | null; widgets: WidgetInstance[] } }) {
  const [role, setRole] = useState<"" | "owner" | "manager" | "estimator" | "viewer">("");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (clear: boolean) => {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/dashboard/layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "company_default", mode, role: role || null, layout: clear ? null : layout }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { tone: "ok", text: clear ? "Company default removed." : "Saved. People without their own layout start from this one." } : { tone: "danger", text: out?.error?.message ?? "Couldn't save." });
  };
  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title="Company dashboard defaults" description={`Use your current ${mode === "accountant" ? "Accountant" : "Contractor"} Mode layout as the starting dashboard for your team. It applies only to people who haven't customized theirs, and each person sees only the widgets they're allowed to.`}>
      <div className="space-y-3" data-testid="dash-company-panel">
        <label className="block"><span className="label">Applies to</span>
          <select className="input w-full" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="">Everyone in the company</option><option value="manager">Managers</option><option value="estimator">Estimators / sales reps</option><option value="viewer">Viewers</option><option value="owner">Owners</option>
          </select>
        </label>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => send(false)} disabled={busy} data-testid="dash-company-save">Save as company default</Button>
          <Button variant="ghost" onClick={() => send(true)} disabled={busy}>Remove this default</Button>
        </div>
      </div>
    </FinDialog>
  );
}
