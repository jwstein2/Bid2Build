"use client";
import { AlertTriangle, CheckCircle2, ChevronRight, Layers, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/estimate/money";
import { COST_TYPES, UNITS, UNIT_ABBR, tradeName } from "@/lib/trades/catalog";
import { SCALE_UNITS } from "@/lib/library/saved-items";
import {
  COST_SOURCE_LABEL, DRAFT_STATUS_LABEL, DUPLICATE_ACTIONS, DUPLICATE_ACTION_LABEL, FOCUS_LABEL, ITEM_COST_TYPES,
  draftMatches, groupByCategory, readiness, stackWarnings,
  type ApprovalPreview, type DraftItem, type DraftStack, type GenerateFocus, type ItemPatch, type ItemReadiness, type StackComponent,
} from "@/lib/library-generator/model";
import { Button } from "../../ui/button";
import { Badge, Card, Notice } from "../../ui/misc";
import { FinDialog } from "../../financials/fin-dialog";
import { approve, generate, getDraft, patchDraft, patchItems, patchStack, previewApproval, type ApproveResult, type DetailResponse, type Match } from "./api";
import { StepBar } from "./step-bar";

type Filter = "all" | "ready" | "needs_cost" | "duplicate" | "done" | "removed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "To review" }, { key: "ready", label: "Ready" }, { key: "needs_cost", label: "Cost not set" },
  { key: "duplicate", label: "Duplicates" }, { key: "done", label: "Approved" }, { key: "removed", label: "Removed" },
];
const READY_BADGE: Record<ItemReadiness, { label: string; tone: "ok" | "warn" | "neutral" | "danger" | "brand" }> = {
  ready: { label: "Ready", tone: "ok" }, needs_cost: { label: "Cost not set", tone: "warn" }, duplicate: { label: "Possible duplicate", tone: "warn" },
  invalid: { label: "Needs a name and unit", tone: "danger" }, done: { label: "In Saved Items", tone: "brand" }, removed: { label: "Removed", tone: "neutral" },
};
const typeLabel = (t: string) => COST_TYPES.find((c) => c.value === t)?.label ?? t;
const unitAbbr = (u: string) => UNIT_ABBR[u] ?? u;
const STALE_MS = 2 * 60_000;

type ApproveState = { itemIds: string[]; stackIds: string[]; title: string; requestKey: string; templates: boolean; share: boolean; preview: ApprovalPreview | null; busy: boolean; error: string | null };

/** Steps 3–7: review by category, enter costs, resolve duplicates, approve, and see where it's used. */
export function DraftReview({ id, reused = false }: { id: string; reused?: boolean }) {
  const [d, setD] = useState<(DetailResponse & { fresh?: boolean }) | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(reused ? { tone: "ok", text: "You generated this same catalog in the last day, so here's that draft again (no new AI cost)." } : null);
  const [busyGen, setBusyGen] = useState<string | null>(null);
  const [appr, setAppr] = useState<ApproveState | null>(null);
  const [done, setDone] = useState<ApproveResult | null>(null);
  const [saving, setSaving] = useState(0);
  const router = useRouter();

  const say = useCallback((text: string, tone: "ok" | "warn" = "ok") => { setNotice({ tone, text }); }, []);
  // "fresh": still generating and not stale (a closed tab or a timeout leaves it "generating").
  const apply = useCallback((r: Awaited<ReturnType<typeof getDraft>>) => {
    if (r.ok) { setD({ ...r.data, fresh: Date.now() - Date.parse(r.data.draft.updatedAt) < STALE_MS }); setLoadError(null); } else setLoadError(r.message);
  }, []);
  const reload = useCallback(async () => { const r = await getDraft(id); apply(r); return r; }, [id, apply]);
  useEffect(() => {
    let cancelled = false;
    getDraft(id).then((r) => { if (!cancelled) apply(r); });
    return () => { cancelled = true; };
  }, [id, apply]);

  // Generating in another tab or a closed page: poll until it's finished (or stale).
  const generating = d?.draft.status === "generating" && Boolean(d.fresh);
  useEffect(() => {
    if (!generating) return;
    const t = window.setInterval(() => { void reload(); }, 4000);
    return () => window.clearInterval(t);
  }, [generating, reload]);

  const items = useMemo(() => d?.items ?? [], [d]);
  const matches = useMemo(() => new Map((d?.matches ?? []).map((m) => [m.id, m])), [d]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, ready: 0, needs_cost: 0, duplicate: 0, done: 0, removed: 0 };
    for (const i of items) {
      const r = readiness(i);
      if (r === "removed") c.removed++; else if (r === "done") c.done++; else { c.all++; if (r === "ready") c.ready++; if (r === "needs_cost") c.needs_cost++; if (r === "duplicate") c.duplicate++; }
    }
    return c;
  }, [items]);
  const visible = useMemo(() => items.filter((i) => {
    const r = readiness(i);
    const f = filter === "all" ? r !== "removed" && r !== "done" : filter === "needs_cost" ? r === "needs_cost" || r === "invalid" : r === filter;
    return f && draftMatches(i, q);
  }), [items, filter, q]);
  const groups = useMemo(() => groupByCategory(visible), [visible]);
  const selectable = (i: DraftItem) => i.status === "candidate";

  const replaceItems = (fresh: DraftItem[]) => setD((x) => (x ? { ...x, items: x.items.map((i) => fresh.find((f) => f.id === i.id) ?? i) } : x));

  async function save(ids: string[], patch: ItemPatch) {
    setSaving((n) => n + 1);
    const r = await patchItems(id, ids, patch);
    setSaving((n) => n - 1);
    if (r.ok) {
      replaceItems(r.data.items);
      // A new duplicate match may need its saved item's details.
      if (r.data.items.some((i) => i.duplicateOf && !matches.has(i.duplicateOf))) void reload();
      return true;
    }
    say(r.message, "warn");
    return false;
  }

  async function more(focus: GenerateFocus, category?: string, regenerate = false) {
    const key = `${focus}:${category ?? ""}:${regenerate}`;
    setBusyGen(key);
    const r = await generate({ draftId: id, focus, category, regenerate });
    setBusyGen(null);
    if (r.ok) {
      setD((x) => (x ? { ...x, ...r.data } : r.data));
      say(r.data.added ? `Added ${r.data.added.items} item${r.data.added.items === 1 ? "" : "s"}${r.data.added.stacks ? ` and ${r.data.added.stacks} stack${r.data.added.stacks === 1 ? "" : "s"}` : ""}. Review them below.` : "Done.");
    } else say(r.message, "warn");
  }

  async function openApprove(itemIds: string[], stackIds: string[], title: string) {
    const st: ApproveState = { itemIds, stackIds, title, requestKey: crypto.randomUUID(), templates: false, share: false, preview: null, busy: true, error: null };
    setAppr(st);
    const r = await previewApproval(id, { requestKey: st.requestKey, itemIds, stackIds, templates: false, shareStacks: false });
    setAppr((a) => (a && a.requestKey === st.requestKey ? { ...a, busy: false, preview: r.ok ? r.data : null, error: r.ok ? null : r.message } : a));
  }
  async function setTemplates(on: boolean) {
    if (!appr) return;
    setAppr({ ...appr, templates: on, busy: true });
    const r = await previewApproval(id, { requestKey: appr.requestKey, itemIds: appr.itemIds, stackIds: appr.stackIds, templates: on, shareStacks: appr.share });
    setAppr((a) => (a ? { ...a, busy: false, preview: r.ok ? r.data : a.preview } : a));
  }
  async function confirmApprove() {
    if (!appr || appr.busy) return;
    setAppr({ ...appr, busy: true, error: null });
    // Same requestKey on a retry: the server returns the first result instead of saving twice.
    const r = await approve(id, { requestKey: appr.requestKey, itemIds: appr.itemIds, stackIds: appr.stackIds, templates: appr.templates, shareStacks: appr.share });
    if (!r.ok) { setAppr((a) => (a ? { ...a, busy: false, error: r.message } : a)); return; }
    setAppr(null);
    setSel(new Set());
    setDone(r.data.result);
    await reload();
  }

  if (loadError && !d) return <Card className="p-6 text-center text-muted">{loadError === "That draft no longer exists." ? loadError : "We couldn't open this draft right now. Please refresh in a moment."} <Link className="font-semibold text-brand underline" href="/dashboard/items/generate">Back to drafts</Link></Card>;
  if (!d) return <Card className="p-6 text-center text-muted">Opening your draft…</Card>;

  const { draft, stacks } = d;
  const step = done ? 7 : counts.needs_cost ? 4 : counts.duplicate ? 5 : counts.ready ? 6 : 3;
  const readyIds = items.filter((i) => readiness(i) === "ready").map((i) => i.id);
  const selIds = [...sel].filter((x) => items.some((i) => i.id === x && selectable(i)));
  const allVisibleIds = visible.filter(selectable).map((i) => i.id);
  const archived = draft.status === "archived";
  const liveStacks = stacks.filter((s) => s.status !== "removed");

  return (
    <div className="space-y-5 pb-24">
      <StepBar current={step} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold text-navy sm:text-3xl">{draft.title}</h1>
          <p className="text-sm text-ink-soft">
            {draft.trades.length ? draft.trades.map(tradeName).join(", ") + " · " : ""}<Badge tone={draft.status === "approved" ? "ok" : draft.status === "failed" ? "warn" : "neutral"}>{DRAFT_STATUS_LABEL[draft.status]}</Badge>
            {" "}· {counts.all} to review · {counts.done} in your Saved Items{saving ? " · Saving…" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {archived
            ? <Button variant="secondary" onClick={async () => { const r = await patchDraft(id, { status: "draft" }); if (r.ok) { void reload(); say("Draft restored."); } }}><Undo2 className="h-4 w-4" aria-hidden /> Restore draft</Button>
            : <>
              <Button variant="secondary" data-testid="save-draft" onClick={async () => { const r = await patchDraft(id, { status: "under_review" }); say(r.ok ? "Draft saved. Come back any time; nothing is in your Saved Items until you approve it." : r.message, r.ok ? "ok" : "warn"); if (r.ok) void reload(); }}>Save Draft</Button>
              <Button variant="ghost" onClick={async () => { const r = await patchDraft(id, { status: "archived" }); if (r.ok) router.push("/dashboard/items/generate"); }}>Archive</Button>
            </>}
        </div>
      </div>

      {notice && <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.tone === "ok" ? "border-ok/30 bg-ok-tint text-ok" : "border-warn/30 bg-warn-tint text-ink"}`}>{notice.text}</p>}

      {generating && (
        <Card className="flex items-center gap-2 p-4" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Generating your catalog. It appears here as soon as it&apos;s ready.</Card>
      )}
      {draft.status === "failed" && !items.length && (
        <Notice tone="warn" title="This catalog didn't finish">
          Nothing was added to your Saved Items. <Button size="sm" variant="secondary" className="ml-2" disabled={Boolean(busyGen)} onClick={() => more("catalog")}>{busyGen ? "Trying again…" : "Try again"}</Button>
        </Notice>
      )}

      {done && (
        <Card className="space-y-2 border-ok/40 bg-ok-tint/60 p-4 sm:p-5" data-testid="approve-done" data-guide="generate.done">
          <p className="flex items-center gap-2 font-display text-lg font-bold text-navy"><CheckCircle2 className="h-5 w-5 text-ok" aria-hidden /> Saved to your library</p>
          <p className="text-sm">
            {[done.created && `${done.created} new item${done.created === 1 ? "" : "s"}`, done.templates && `${done.templates} unpriced template${done.templates === 1 ? "" : "s"}`,
              done.updated && `${done.updated} updated`, done.merged && `${done.merged} filled in`, done.matched && `${done.matched} kept as you had them`, done.stacks && `${done.stacks} stack${done.stacks === 1 ? "" : "s"}`]
              .filter(Boolean).join(", ") || "No changes"}.
            {done.awaitingPrice ? ` ${done.awaitingPrice} still need a cost and stay in this draft.` : ""}
          </p>
          <p className="text-sm text-ink-soft">In any bid, open <b>Suggested &amp; Saved Items</b> to add them. Each estimate keeps its own copy of the price, so changing your library later never changes a bid you already sent.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/items" className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-white">See my Saved Items</Link>
            <Link href="/builder" className="inline-flex min-h-11 items-center rounded-lg border border-line-strong px-4 font-semibold">Start a bid</Link>
            <Button variant="ghost" onClick={() => setDone(null)}>Keep reviewing</Button>
          </div>
        </Card>
      )}

      {draft.notes.length > 0 && !done && (
        <details className="rounded-lg border border-line bg-surface px-4 py-2 text-sm">
          <summary className="cursor-pointer font-semibold">Notes about this catalog</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">{draft.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </details>
      )}

      {!archived && items.length > 0 && (
        <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-line bg-paper/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border" data-guide="generate.toolbar">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input className="field pl-9" placeholder="Search generated items…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search generated items" />
            </div>
            <Button size="sm" variant="secondary" onClick={() => setSel(new Set([...sel, ...allVisibleIds]))} data-testid="select-all">Select All</Button>
            <Button size="sm" variant="secondary" onClick={() => setSel(new Set())} disabled={!sel.size}>Deselect All</Button>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
                className={`min-h-9 shrink-0 rounded-full border px-3 text-sm ${filter === f.key ? "border-navy bg-navy text-white" : "border-line"}`}>
                {f.label} <span className="opacity-70">{f.key === "all" ? counts.all : counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!archived && items.length > 0 && (
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" data-guide="generate.more">
          {(["more", "labor", "equipment", "materials", "alternatives", "assemblies"] as GenerateFocus[]).map((f) => (
            <Button key={f} size="sm" variant="ghost" className="shrink-0" disabled={Boolean(busyGen) || generating} onClick={() => more(f)}>
              {busyGen === `${f}::false` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : f === "assemblies" ? <Layers className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} {FOCUS_LABEL[f]}
            </Button>
          ))}
        </div>
      )}

      <section aria-label="Generated items" className="space-y-3" data-guide="generate.items">
        {!groups.length && items.length > 0 && <Card className="p-6 text-center text-sm text-muted">{q ? `Nothing matches “${q}”.` : "Nothing here."}</Card>}
        {groups.map((g) => {
          const ids = g.items.filter(selectable).map((i) => i.id);
          const allOn = ids.length > 0 && ids.every((x) => sel.has(x));
          const readyHere = g.items.filter((i) => readiness(i) === "ready").map((i) => i.id);
          return (
            <Card key={g.name} className="overflow-hidden">
              <details open className="group/cat">
                <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-2 border-b border-line px-3 py-2 [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open/cat:rotate-90" aria-hidden />
                  {ids.length > 0 && (
                    <input type="checkbox" className="h-5 w-5" checked={allOn} aria-label={`Select all in ${g.name}`} onClick={(e) => e.stopPropagation()}
                      onChange={() => setSel((s) => { const n = new Set(s); for (const x of ids) { if (allOn) n.delete(x); else n.add(x); } return n; })} />
                  )}
                  <span className="font-bold">{g.name}</span>
                  <span className="text-sm text-muted">({g.items.length}{readyHere.length ? ` · ${readyHere.length} ready` : ""})</span>
                  <span className="ml-auto flex flex-wrap gap-1" onClick={(e) => e.preventDefault()}>
                    {!archived && <Button size="sm" variant="ghost" disabled={Boolean(busyGen)} onClick={() => more("more", g.name)} aria-label={`More items in ${g.name}`}>{busyGen === `more:${g.name}:false` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} More</Button>}
                    {!archived && <Button size="sm" variant="ghost" disabled={Boolean(busyGen)} onClick={() => more("more", g.name, true)} aria-label={`Regenerate ${g.name}`}>{busyGen === `more:${g.name}:true` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Regenerate</Button>}
                    {readyHere.length > 0 && !archived && <Button size="sm" variant="secondary" onClick={() => openApprove(readyHere, [], `Approve ${g.name}`)}>Approve category</Button>}
                  </span>
                </summary>
                <ul className="divide-y divide-line">
                  {g.items.map((i) => (
                    <ItemRow key={i.id} item={i} match={i.duplicateOf ? matches.get(i.duplicateOf) : undefined} selected={sel.has(i.id)} disabled={archived}
                      onSelect={(on) => setSel((s) => { const n = new Set(s); if (on) n.add(i.id); else n.delete(i.id); return n; })}
                      onSave={(patch) => save([i.id], patch)} />
                  ))}
                </ul>
              </details>
            </Card>
          );
        })}
      </section>

      {liveStacks.length > 0 && (
        <section aria-labelledby="gen-stacks-h" className="space-y-3" data-guide="generate.stacks">
          <div>
            <h2 id="gen-stacks-h" className="font-display text-xl font-bold text-navy">Suggested stacks</h2>
            <p className="text-sm text-ink-soft">Stacks add a group of rows scaled by one measurement. Check each ratio against how you build; they&apos;re starting points, not rules. Approving items never saves a stack. Save each one on its own.</p>
          </div>
          {!d.stacksAccess && <Notice tone="neutral">Saved Stacks are part of Individual Unlimited. You can still review them here, and approve the items.</Notice>}
          {liveStacks.map((s) => (
            <StackCard key={`${s.id}:${JSON.stringify(s.components)}`} stack={s} items={items} canSave={d.stacksAccess && !archived}
              onSave={async (patch) => { const r = await patchStack(id, s.id, patch); if (!r.ok) say(r.message, "warn"); await reload(); return r.ok; }}
              onApprove={() => openApprove([], [s.id], `Save stack “${s.name}”`)} />
          ))}
        </section>
      )}

      {!archived && counts.all > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 py-3 pl-20 pr-4 shadow-lg backdrop-blur sm:pl-4" data-guide="generate.approve">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            <span className="mr-auto basis-full text-sm text-ink-soft sm:basis-auto">{selIds.length ? `${selIds.length} selected` : `${counts.ready} ready to approve`}</span>
            {selIds.length > 0 && <Button size="sm" variant="ghost" onClick={async () => { if (await save(selIds, { removed: true })) { setSel(new Set()); say(`Removed ${selIds.length} item${selIds.length === 1 ? "" : "s"} from the draft.`); } }}><Trash2 className="h-4 w-4" aria-hidden /> Remove</Button>}
            <Button size="sm" variant="secondary" disabled={!selIds.length} onClick={() => openApprove(selIds, [], "Approve selected")} data-testid="approve-selected">Approve Selected</Button>
            <Button size="sm" disabled={!readyIds.length} onClick={() => openApprove(readyIds, [], "Approve all ready items")} data-testid="approve-ready">Approve All Ready Items</Button>
          </div>
        </div>
      )}

      <FinDialog open={Boolean(appr)} onOpenChange={(o) => { if (!o && !appr?.busy) setAppr(null); }} title={appr?.title ?? ""} description="Check what will change, then confirm.">
        {appr && <ApproveBody st={appr} canShare={d.canShare} onTemplates={setTemplates} onShare={(on) => setAppr({ ...appr, share: on })} onConfirm={confirmApprove} onCancel={() => setAppr(null)} />}
      </FinDialog>
    </div>
  );
}

function ItemRow({ item: i, match, selected, disabled, onSelect, onSave }: { item: DraftItem; match?: Match; selected: boolean; disabled: boolean; onSelect: (on: boolean) => void; onSave: (p: ItemPatch) => Promise<boolean> }) {
  const r = readiness(i);
  const editable = i.status === "candidate" && !disabled;
  const [name, setName] = useState(i.name);
  const [cost, setCost] = useState(i.unitCost);
  const [open, setOpen] = useState(false);
  const last = useRef({ name: i.name, cost: i.unitCost });
  useEffect(() => { if (last.current.name !== i.name) { last.current.name = i.name; setName(i.name); } if (last.current.cost !== i.unitCost) { last.current.cost = i.unitCost; setCost(i.unitCost); } }, [i.name, i.unitCost]);
  const units = (UNITS as readonly string[]).includes(i.unit) ? UNITS : [i.unit, ...UNITS];
  const costOk = /^\d*(\.\d{0,4})?$/.test(cost.trim());
  const b = READY_BADGE[r];

  return (
    <li className={`px-3 py-3 text-sm ${r === "removed" ? "opacity-60" : ""}`} data-testid="draft-item">
      <div className="flex items-start gap-2">
        {i.status === "candidate" ? (
          <input type="checkbox" className="mt-2.5 h-5 w-5 shrink-0" checked={selected} disabled={disabled} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${i.name}`} />
        ) : <span className="w-5 shrink-0" />}
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_8.5rem] sm:items-start">
          <div className="min-w-0">
            <input className="field font-semibold" value={name} disabled={!editable} aria-label="Item name" maxLength={300}
              onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== i.name) void onSave({ name: name.trim() }); else setName(i.name); }} />
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tone={b.tone}>{b.label}</Badge>
              <span className="text-muted">{typeLabel(i.costType)}</span>
              {i.optional && <Badge tone="neutral">Optional</Badge>}
              {i.confidence === "low" && <Badge tone="warn">Check this item</Badge>}
              {i.unitCost && <span className="text-muted">{COST_SOURCE_LABEL[i.costSource]}{i.costSourceNote ? `: ${i.costSourceNote}` : ""}</span>}
              <button type="button" className="min-h-8 font-semibold text-brand underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Less" : "Details"}</button>
            </div>
          </div>
          <label className="block">
            <span className="sr-only">Unit</span>
            <select className="field" value={i.unit} disabled={!editable} onChange={(e) => void onSave({ unit: e.target.value })} aria-label={`Unit for ${i.name}`}>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Your cost per {i.unit}</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input className={`field pl-6 ${!costOk ? "border-danger" : ""}`} inputMode="decimal" placeholder="Cost not set" value={cost} disabled={!editable}
                aria-label={`Your cost per ${i.unit} for ${i.name}`} aria-invalid={!costOk}
                onChange={(e) => setCost(e.target.value)} onBlur={() => { if (costOk && cost.trim() !== i.unitCost) void onSave({ unitCost: cost.trim() }); }} />
            </div>
            <span className="mt-0.5 block text-[11px] text-muted">per {unitAbbr(i.unit)}{i.taxable ? "" : " · not taxed"}</span>
          </label>
        </div>
        {editable && (
          <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted hover:text-danger" aria-label={`Remove ${i.name}`} onClick={() => void onSave({ removed: true })}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
        {i.status === "removed" && !disabled && (
          <Button size="sm" variant="ghost" onClick={() => void onSave({ removed: false })}><Undo2 className="h-4 w-4" aria-hidden /> Restore</Button>
        )}
      </div>

      {editable && !i.unitCost && i.suggestedCost && (
        <p className="ml-7 mt-2 text-xs">
          <button type="button" className="font-semibold text-brand underline" onClick={() => void onSave({ costAction: "accept_suggestion" })}>Use {formatCurrency(i.suggestedCost)} / {unitAbbr(i.unit)}</button>
          <span className="text-muted"> · {i.suggestedNote}</span>
        </p>
      )}

      {i.duplicateOf && i.status === "candidate" && (
        <div className="ml-7 mt-2 rounded-lg border border-warn/40 bg-warn-tint/60 p-2 text-xs" data-testid="duplicate-box">
          <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {i.duplicateLevel === "exact" ? "Already in your Saved Items" : "Might already be in your Saved Items"}: {i.duplicateReason}</p>
          {match && <p className="mt-0.5 text-ink-soft">Yours: <b>{match.name}</b> · {match.unitCost ? `${formatCurrency(match.unitCost)} / ${unitAbbr(match.unit)}` : `${unitAbbr(match.unit)} · cost not set`}{match.supplierName ? ` · ${match.supplierName}` : ""}</p>}
          <select className="field mt-1" value={i.duplicateAction ?? ""} disabled={!editable} onChange={(e) => void onSave({ duplicateAction: (e.target.value || null) as ItemPatch["duplicateAction"] })} aria-label={`What to do with ${i.name}`}>
            <option value="">Choose what to do…</option>
            {DUPLICATE_ACTIONS.map((a) => <option key={a} value={a}>{DUPLICATE_ACTION_LABEL[a]}</option>)}
          </select>
          {i.duplicateAction === "update_existing" && <p className="mt-1 text-ink-soft">Your saved price changes to this cost only after you confirm. The old price is kept in the item&apos;s history.</p>}
          {i.duplicateAction === "merge" && <p className="mt-1 text-ink-soft">Only empty details are filled in. Your saved price is never replaced.</p>}
        </div>
      )}

      {open && (
        <div className="ml-7 mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold">Description
            <textarea className="field mt-1 min-h-16 font-normal" defaultValue={i.description} disabled={!editable} maxLength={4000} onBlur={(e) => { if (e.target.value !== i.description) void onSave({ description: e.target.value }); }} />
          </label>
          <div className="grid gap-2">
            <label className="text-xs font-semibold">Type
              <select className="field mt-1 font-normal" value={i.costType} disabled={!editable} onChange={(e) => void onSave({ costType: e.target.value as DraftItem["costType"] })}>
                {ITEM_COST_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold">Category
              <input className="field mt-1 font-normal" defaultValue={i.category} disabled={!editable} maxLength={120} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== i.category) void onSave({ category: e.target.value.trim() }); }} />
            </label>
            <label className="text-xs font-semibold">Supplier SKU (optional)
              <input className="field mt-1 font-normal" defaultValue={i.supplierSku} disabled={!editable} maxLength={80} onBlur={(e) => { if (e.target.value.trim() !== i.supplierSku) void onSave({ supplierSku: e.target.value.trim() }); }} />
            </label>
          </div>
          <label className="text-xs font-semibold sm:col-span-2">Installation notes
            <input className="field mt-1 font-normal" defaultValue={i.notes} disabled={!editable} maxLength={1000} onBlur={(e) => { if (e.target.value !== i.notes) void onSave({ notes: e.target.value }); }} />
          </label>
          {(i.conditions.length > 0 || i.verifyNote) && (
            <div className="text-xs text-ink-soft sm:col-span-2">
              {i.conditions.length > 0 && <p><b>Quantity depends on:</b> {i.conditions.join(", ")}</p>}
              {i.verifyNote && <p><b>Check:</b> {i.verifyNote}</p>}
            </div>
          )}
          {i.unitCost && editable && <button type="button" className="justify-self-start text-xs font-semibold text-brand underline" onClick={() => void onSave({ costAction: "clear" })}>Clear cost</button>}
        </div>
      )}
    </li>
  );
}

function StackCard({ stack: s, items, canSave, onSave, onApprove }: { stack: DraftStack; items: DraftItem[]; canSave: boolean; onSave: (p: { name?: string; scaleUnit?: DraftStack["scaleUnit"]; components?: StackComponent[]; removed?: boolean }) => Promise<boolean>; onApprove: () => void }) {
  const [rows, setRows] = useState<StackComponent[]>(s.components);
  const byId = new Map(items.map((i) => [i.id, i]));
  const warnings = stackWarnings({ scaleUnit: s.scaleUnit, components: rows }, items);
  const approved = s.status === "approved";
  const editable = !approved && canSave;
  const commit = (next: StackComponent[]) => { setRows(next); void onSave({ components: next }); };
  const set = (k: number, patch: Partial<StackComponent>) => setRows((r) => r.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  return (
    <Card className="p-4" data-testid="draft-stack">
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 text-brand" aria-hidden />
        <p className="font-bold">{s.name}</p>
        <span className="text-sm text-muted">{s.trade ? tradeName(s.trade) + " · " : ""}per {s.scaleUnit ? unitAbbr(s.scaleUnit) : "job"}{s.scaleLabel ? ` (${s.scaleLabel})` : ""}</span>
        {approved ? <Badge tone="ok">In your Saved Stacks</Badge> : <Badge tone="neutral">Needs review</Badge>}
      </div>
      {s.assumptions.length > 0 && <p className="mt-1 text-xs text-ink-soft"><b>Assumes:</b> {s.assumptions.join(" · ")}. Change the amounts to fit each job.</p>}
      {editable && (
        <label className="mt-2 block text-xs font-semibold">Measured in
          <select className="field mt-1 max-w-xs font-normal" value={s.scaleUnit ?? ""} onChange={(e) => void onSave({ scaleUnit: (e.target.value || null) as DraftStack["scaleUnit"] })}>
            <option value="">Not scaled (fixed quantities)</option>
            {SCALE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-2 font-semibold">Row</th><th className="py-1 pr-2 font-semibold">{s.scaleUnit ? `Per 1 ${unitAbbr(s.scaleUnit)}` : "Quantity"}</th><th className="py-1 pr-2 font-semibold">Waste %</th><th className="py-1 pr-2 font-semibold">Round up</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((c, k) => {
              const it = byId.get(c.itemId);
              return (
                <tr key={c.itemId + k}>
                  <td className="py-1.5 pr-2">
                    <span className={it?.status === "removed" ? "line-through" : ""}>{it?.name ?? "Removed item"}</span>
                    <span className="text-xs text-muted"> · {it ? unitAbbr(it.unit) : ""}{it && !it.unitCost && !it.savedItemId ? " · cost not set" : ""}{c.optional ? " · optional" : ""}</span>
                    {c.note && <span className="block text-[11px] text-muted">{c.note}</span>}
                  </td>
                  <td className="py-1.5 pr-2">
                    {s.scaleUnit
                      ? <input className="field w-28" inputMode="decimal" value={c.per} disabled={!editable} placeholder="fixed" aria-label={`Amount per unit for ${it?.name ?? "row"}`} onChange={(e) => set(k, { per: e.target.value })} onBlur={() => commit(rows)} />
                      : <input className="field w-24" inputMode="decimal" value={c.quantity} disabled={!editable} aria-label={`Quantity for ${it?.name ?? "row"}`} onChange={(e) => set(k, { quantity: e.target.value })} onBlur={() => commit(rows)} />}
                  </td>
                  <td className="py-1.5 pr-2"><input className="field w-20" inputMode="decimal" value={c.wastePct} disabled={!editable || !s.scaleUnit} aria-label={`Waste for ${it?.name ?? "row"}`} onChange={(e) => set(k, { wastePct: e.target.value })} onBlur={() => commit(rows)} /></td>
                  <td className="py-1.5 pr-2"><input type="checkbox" className="h-5 w-5" checked={c.roundUp} disabled={!editable || !s.scaleUnit} aria-label={`Round up ${it?.name ?? "row"}`} onChange={(e) => commit(rows.map((x, j) => (j === k ? { ...x, roundUp: e.target.checked } : x)))} /></td>
                  <td className="py-1.5">{editable && <button type="button" className="inline-flex min-h-9 min-w-9 items-center justify-center text-muted hover:text-danger" aria-label={`Remove ${it?.name ?? "row"} from the stack`} onClick={() => commit(rows.filter((_, j) => j !== k))}><Trash2 className="h-4 w-4" aria-hidden /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {warnings.length > 0 && !approved && (
        <ul className="mt-2 space-y-1 text-xs text-ink-soft">{warnings.map((w) => <li key={w} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />{w}</li>)}</ul>
      )}
      {!approved && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={!canSave || !rows.length} onClick={onApprove} data-testid="stack-approve"><Sparkles className="h-4 w-4" aria-hidden /> Review and save stack</Button>
          {canSave && <Button size="sm" variant="ghost" onClick={() => void onSave({ removed: true })}>Remove stack</Button>}
        </div>
      )}
    </Card>
  );
}

function ApproveBody({ st, canShare, onTemplates, onShare, onConfirm, onCancel }: { st: ApproveState; canShare: boolean; onTemplates: (on: boolean) => void; onShare: (on: boolean) => void; onConfirm: () => void; onCancel: () => void }) {
  const p = st.preview;
  if (!p) return st.error ? <Notice tone="warn">{st.error}</Notice> : <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking your selection…</p>;
  const rows: [string, number][] = [
    ["New Saved Items", p.created], ["Unpriced templates", p.templates], ["Matched to items you already have (no change)", p.matched],
    ["Existing items updated", p.updated], ["Existing items with details filled in", p.merged], ["Still awaiting a cost (stay in the draft)", p.awaitingPrice],
    ["Skipped", p.skipped], ["Stacks to save", p.stacks],
  ];
  const nothing = p.created + p.templates + p.matched + p.updated + p.merged + p.stacks === 0;
  return (
    <div className="space-y-4" data-testid="approve-dialog">
      <dl className="divide-y divide-line rounded-lg border border-line text-sm">
        {rows.filter(([, n], k) => n > 0 || k < 2).map(([label, n]) => (
          <div key={label} className="flex items-center justify-between gap-2 px-3 py-2"><dt>{label}</dt><dd className="font-bold tabular-nums">{n}</dd></div>
        ))}
      </dl>
      {p.conflicts.length > 0 && (
        <Notice tone="warn" title={`${p.conflicts.length} possible duplicate${p.conflicts.length === 1 ? "" : "s"} to resolve first`}>
          <ul className="mt-1 list-disc pl-5">{p.conflicts.slice(0, 8).map((c) => <li key={c.itemId}>{c.name}: {c.reason}</li>)}</ul>
          Choose “Keep my existing item”, “Add as a separate item”, “Update” or “Fill in missing details” on each one.
        </Notice>
      )}
      {p.priceChanges.length > 0 && (
        <Notice tone="neutral" title="These saved prices will change">
          <ul className="mt-1 list-disc pl-5">{p.priceChanges.map((c) => <li key={c.itemId}>{c.name}: {c.from === "not set" ? "not set" : formatCurrency(c.from)} → {formatCurrency(c.to)}</li>)}</ul>
          Bids you already made keep their prices.
        </Notice>
      )}
      {(p.awaitingPrice > 0 || st.templates) && st.stackIds.length === 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={st.templates} onChange={(e) => onTemplates(e.target.checked)} disabled={st.busy} data-testid="approve-templates" />
          <span>Also save items without a cost as <b>Unpriced Templates</b>. They show “Cost not set” and you add your price in each bid.</span>
        </label>
      )}
      {st.stackIds.length > 0 && canShare && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={st.share} onChange={(e) => onShare(e.target.checked)} disabled={st.busy} />
          <span>Share as a company template (everyone on your team can use it)</span>
        </label>
      )}
      {st.error && <Notice tone="warn">{st.error}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={st.busy}>Cancel</Button>
        <Button onClick={onConfirm} disabled={st.busy || nothing || p.conflicts.length > 0} data-testid="approve-confirm">
          {st.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Confirm and save
        </Button>
      </div>
    </div>
  );
}
