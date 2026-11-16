"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { CheckCircle2, ChevronDown, Hourglass, Clock, MoreVertical, UserCheck, ArrowRight } from "lucide-react";
import {
  COLUMN_HINTS, COLUMN_LABELS, COLUMNS, JOB_COLUMNS, SALES_COLUMNS, approvalOf, checkMove, columnOf, columnTotals, lastActivity,
  nextAction, stageForColumn, valueOf, type BoardBid, type Column, type Stage,
} from "@/lib/pipeline/board";
import { cn } from "@/lib/cn";
import { isPmEnabled } from "@/lib/env";
import { MoveDialog, type MoveExtras } from "./move-dialog";
import { money, relDay } from "./format";

type Toast = { text: string; tone: "ok" | "danger"; undo?: () => void } | null;

/** Kanban board. Native drag-and-drop on desktop; every move is also in each card's "Move to" menu (keyboard + touch). */
export function PipelineBoard({ bids, esign, focus }: { bids: BoardBid[]; esign: boolean; focus?: Column[] }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, { stage: Stage; wonAt?: string | null }>>({});
  const [pending, setPending] = useState<{ bid: BoardBid; to: Column; confirm: "won" | "lost" | "reopen" | "job" } | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Column | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The ref is read by drag handlers that fire before React re-renders with dragId.
  const dragRef = useRef<string | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const view = useMemo(() => bids.map((b) => {
    // An optimistic override only applies until the refreshed server data shows the same stage.
    const o = overrides[b.id];
    return o && o.stage !== b.stage ? { ...b, ...o } : b;
  }), [bids, overrides]);
  const totals = useMemo(() => columnTotals(view), [view]);
  const byCol = useMemo(() => {
    const m = Object.fromEntries(COLUMNS.map((c) => [c, [] as BoardBid[]])) as Record<Column, BoardBid[]>;
    for (const b of view) m[columnOf(b)].push(b);
    for (const c of COLUMNS) m[c].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
    return m;
  }, [view]);

  function show(t: Toast) {
    setToast(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), t?.undo ? 9000 : 6000);
  }

  async function post(id: string, stage: Stage, extras: MoveExtras = {}) {
    const r = await fetch("/api/pipeline/stage", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ estimateId: id, stage, note: extras.note || undefined, effectiveDate: extras.date || undefined }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    return r?.ok ? null : (d?.error?.message as string | undefined) ?? "Couldn't save that move. Check your connection and try again.";
  }

  async function commit(b: BoardBid, to: Column, extras: MoveExtras = {}, isUndo = false) {
    const prev = { stage: b.stage, wonAt: b.wonAt };
    const stage = stageForColumn(to, b);
    setOverrides((o) => ({ ...o, [b.id]: { stage, wonAt: to === "won" ? (extras.date ? `${extras.date}T12:00:00Z` : new Date().toISOString()) : b.wonAt } }));
    const err = await post(b.id, stage, extras);
    if (err) {
      setOverrides((o) => ({ ...o, [b.id]: prev }));
      show({ text: err, tone: "danger" });
      return;
    }
    const fromCol = columnOf(b);
    show({
      text: isUndo ? `Moved "${b.title}" back to ${COLUMN_LABELS[to]}.` : `Moved "${b.title}" to ${COLUMN_LABELS[to]}.`, tone: "ok",
      // Undo puts the stage back; the move and the undo both stay in the bid's history.
      undo: isUndo || checkMove({ ...b, stage }, fromCol).ok === false ? undefined : () => commit({ ...b, stage }, fromCol, {}, true),
    });
    router.refresh();
  }

  function request(b: BoardBid, to: Column) {
    const c = checkMove(b, to);
    if (!c.ok) { show({ text: c.reason, tone: "danger" }); return; }
    if (c.confirm) setPending({ bid: b, to, confirm: c.confirm });
    else void commit(b, to);
  }

  const dragged = dragId ? view.find((b) => b.id === dragId) ?? null : null;
  const draggedNow = () => (dragRef.current ? view.find((b) => b.id === dragRef.current) ?? null : null);
  const colProps = (c: Column) => ({
    col: c, bids: byCol[c], total: totals[c], esign, onMove: request,
    dropState: dragged ? (checkMove(dragged, c).ok ? (overCol === c ? "over" : "can") : "no") as "over" | "can" | "no" : null,
    onDragOver: (e: React.DragEvent) => { const b = draggedNow(); if (b && checkMove(b, c).ok) { e.preventDefault(); if (overCol !== c) setOverCol(c); } },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOverCol(null); const b = draggedNow(); dragRef.current = null; setDragId(null); if (b) request(b, c); },
    onDragStart: (id: string) => { dragRef.current = id; setDragId(id); }, onDragEnd: () => { dragRef.current = null; setDragId(null); setOverCol(null); },
  });

  return (
    <div data-testid="pipeline-board">
      {/* Row 1: selling stages. Row 2: jobs and the separate Lost / Declined outcome. Wide screens fit all columns;
          narrower ones scroll sideways; phones stack collapsible sections. */}
      {focus ? (
        // A KPI card narrowed the board: only the stages behind that number, in one row.
        <div className="overflow-x-auto md:pb-1" data-testid="pipeline-focus">
          <div className="flex flex-col gap-3 md:grid md:items-start" style={{ gridTemplateColumns: `repeat(${focus.length}, minmax(200px, 1fr))` }}>
            {focus.map((c) => <BoardColumn key={c} {...colProps(c)} forceOpen />)}
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto md:pb-1">
            <div className="flex flex-col gap-3 md:grid md:grid-cols-[repeat(5,minmax(200px,1fr))] md:items-start">
              {SALES_COLUMNS.map((c) => <BoardColumn key={c} {...colProps(c)} />)}
            </div>
          </div>
          <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-muted">Jobs &amp; outcomes</h3>
          <div className="overflow-x-auto md:pb-1">
            <div className="flex flex-col gap-3 md:grid md:grid-cols-[repeat(4,minmax(200px,1fr))] md:items-start">
              {[...JOB_COLUMNS, "lost" as const].map((c) => <BoardColumn key={c} {...colProps(c)} />)}
            </div>
          </div>
        </>
      )}
      {pending && (
        <MoveDialog
          bid={pending.bid} to={pending.to} kind={pending.confirm}
          onCancel={() => setPending(null)}
          onConfirm={(extras) => { const p = pending; setPending(null); void commit(p.bid, p.to, extras); }}
        />
      )}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        {toast && (
          <div role={toast.tone === "danger" ? "alert" : "status"} data-testid="pipeline-toast"
            className={cn("pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-2xl", toast.tone === "ok" ? "bg-navy text-white" : "bg-danger text-white")}>
            <span>{toast.text}</span>
            {toast.undo && <button type="button" onClick={() => { const u = toast.undo!; setToast(null); u(); }} className="rounded-md bg-white/15 px-2 py-1 font-bold hover:bg-white/25">Undo</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function BoardColumn({ col, bids, total, esign, onMove, dropState, onDragOver, onDrop, onDragStart, onDragEnd, forceOpen }: {
  col: Column; bids: BoardBid[]; total: { count: number; value: number; unpriced: number }; esign: boolean; forceOpen?: boolean;
  onMove: (b: BoardBid, to: Column) => void; dropState: "over" | "can" | "no" | null;
  onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void; onDragStart: (id: string) => void; onDragEnd: () => void;
}) {
  // Mobile: columns stack and collapse. Empty columns and Lost start collapsed.
  const [open, setOpen] = useState(Boolean(forceOpen) || (col !== "lost" && col !== "completed" && bids.length > 0));
  const headId = `col-${col}`;
  return (
    <section
      aria-labelledby={headId} data-testid={`column-${col}`} onDragOver={onDragOver} onDrop={onDrop}
      className={cn(
        "rounded-xl border bg-surface transition-colors",
        dropState === "over" ? "border-accent ring-2 ring-accent/40" : dropState === "can" ? "border-dashed border-accent/60" : dropState === "no" ? "opacity-50" : "border-line",
      )}
    >
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 p-3 text-left md:cursor-default">
        <span className="min-w-0">
          <span id={headId} className="block text-sm font-bold text-navy">{COLUMN_LABELS[col]} <span className="font-semibold text-muted">· {total.count}</span></span>
          <span className="block text-xs text-muted" title={COLUMN_HINTS[col]}>
            <span className="tabular font-semibold text-ink-soft" data-testid={`column-${col}-value`}>{total.count && total.count === total.unpriced ? "No prices yet" : money(total.value)}</span>
            {total.unpriced > 0 && total.unpriced < total.count && <> · {total.unpriced} not priced</>}
          </span>
        </span>
        <ChevronDown aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform", open && "rotate-180", "md:hidden")} />
      </button>
      <div className={cn(open ? "block" : "hidden", "md:block")}>
        {bids.length === 0 ? (
          <p className="px-3 pb-3 text-xs text-muted">{COLUMN_HINTS[col]}</p>
        ) : (
          <ul className="space-y-2 px-2 pb-2">
            {bids.map((b) => <li key={b.id}><BidCard b={b} esign={esign} onMove={onMove} onDragStart={onDragStart} onDragEnd={onDragEnd} /></li>)}
          </ul>
        )}
      </div>
    </section>
  );
}

function BidCard({ b, esign, onMove, onDragStart, onDragEnd }: { b: BoardBid; esign: boolean; onMove: (b: BoardBid, to: Column) => void; onDragStart: (id: string) => void; onDragEnd: () => void }) {
  const col = columnOf(b);
  const value = valueOf(b);
  const approval = approvalOf(b);
  const action = nextAction(b, esign, isPmEnabled());
  return (
    <article
      draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.id); onDragStart(b.id); }} onDragEnd={onDragEnd}
      data-testid="bid-card" data-bid={b.id}
      className="group rounded-lg border border-line bg-surface p-3 shadow-sm hover:border-brand/40 md:cursor-grab md:active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-muted">{b.customer || "No customer yet"}</p>
          <Link href={`/estimates/${b.id}`} className="line-clamp-2 text-sm font-bold leading-snug text-ink hover:text-brand">{b.title}</Link>
        </div>
        <MoveMenu b={b} col={col} onMove={onMove} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="tabular text-sm font-extrabold text-navy">{value === null ? <span className="font-semibold text-muted">Not priced yet</span> : money(value, true)}</span>
        <SignBadge b={b} />
        {approval?.kind === "manual" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 font-bold text-brand" data-testid="manual-approval">
            <UserCheck className="h-3 w-3" aria-hidden />Approved manually{approval.at ? ` ${new Date(approval.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
          </span>
        )}
      </div>
      {col === "lost" && b.lostReason && <p className="mt-1 line-clamp-2 text-xs text-ink-soft">Reason: {b.lostReason}</p>}
      <p className="mt-1 text-[11px] text-muted">#{b.number} · {relDay(lastActivity(b))}</p>
      <div className="mt-2 flex justify-end">
        {action && (action.href ? (
          <Link href={action.href} className="inline-flex min-h-8 items-center gap-1 rounded-md bg-brand-tint px-2 text-xs font-bold text-navy hover:bg-accent-tint" data-testid="next-action">{action.label}<ArrowRight className="h-3 w-3" aria-hidden /></Link>
        ) : (
          <button type="button" onClick={() => onMove(b, action.move!)} className="inline-flex min-h-8 items-center gap-1 rounded-md bg-accent px-2 text-xs font-bold text-navy hover:bg-accent-hover" data-testid="next-action">{action.label}<ArrowRight className="h-3 w-3" aria-hidden /></button>
        ))}
      </div>
    </article>
  );
}

function SignBadge({ b }: { b: BoardBid }) {
  const s = b.signing;
  if (!s || s.state === "none") return null;
  if (s.signed) return <span className="inline-flex items-center gap-1 rounded-full bg-ok-tint px-2 py-0.5 font-bold text-ok" data-testid="esigned"><CheckCircle2 className="h-3 w-3" aria-hidden />E-signed v{s.signed.versionNumber}</span>;
  if (s.state === "awaiting") return <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 font-bold text-accent-dark"><Hourglass className="h-3 w-3" aria-hidden />Signing link out</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 font-bold text-ink-soft"><Clock className="h-3 w-3" aria-hidden />Link {s.state}</span>;
}

function MoveMenu({ b, col, onMove }: { b: BoardBid; col: Column; onMove: (b: BoardBid, to: Column) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={`Move ${b.title}`} className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-black/5 hover:text-navy" data-testid="move-menu">
        <MoreVertical className="h-4 w-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-xl border border-line bg-surface p-1 shadow-2xl">
          <Menu.Label className="px-2 py-1 text-xs font-bold uppercase tracking-wider text-muted">Move to</Menu.Label>
          {COLUMNS.filter((c) => c !== col).map((c) => {
            const chk = checkMove(b, c);
            return (
              <Menu.Item key={c} disabled={!chk.ok} onSelect={() => onMove(b, c)} title={chk.ok ? undefined : chk.reason}
                className="flex min-h-10 cursor-pointer items-center rounded-md px-2 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-muted data-[highlighted]:bg-brand-tint">
                {COLUMN_LABELS[c]}
              </Menu.Item>
            );
          })}
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item asChild><Link href={`/estimates/${b.id}`} className="flex min-h-10 items-center rounded-md px-2 text-sm outline-none data-[highlighted]:bg-brand-tint">Open bid</Link></Menu.Item>
          {b.signing?.signed && <Menu.Item asChild><Link href={`/signed/${b.signing.signed.id}`} className="flex min-h-10 items-center rounded-md px-2 text-sm outline-none data-[highlighted]:bg-brand-tint">View signed proposal</Link></Menu.Item>}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
