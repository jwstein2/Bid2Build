"use client";
import Link from "next/link";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ArrowRight, CheckCircle2, Clock, Hourglass, MoreVertical, Trash2, UserCheck } from "lucide-react";
import { COLUMNS, COLUMN_LABELS, approvalOf, checkMove, columnOf, deleteBlock, lastActivity, nextAction, valueOf, type BoardBid, type Column } from "@/lib/pipeline/board";
import { isPmEnabled } from "@/lib/env";
import { money, relDay } from "./format";

/**
 * One bid on the pipeline (board column or expanded stage grid). Hierarchy: customer, project, value and last
 * activity, then one primary action. Moves and the other links live in the ⋮ menu.
 */
export function BidCard({ b, esign, onMove, onDelete, onDragStart, onDragEnd }: {
  b: BoardBid; esign: boolean; onMove: (b: BoardBid, to: Column) => void;
  /** Shows Delete bid in the ⋮ menu (asks for confirmation first). */
  onDelete?: (b: BoardBid) => void;
  /** Omit both to make the card non-draggable (expanded stage view). */
  onDragStart?: (id: string) => void; onDragEnd?: () => void;
}) {
  const col = columnOf(b);
  const value = valueOf(b);
  const approval = approvalOf(b);
  const action = nextAction(b, esign, isPmEnabled());
  const drag = Boolean(onDragStart);
  return (
    <article
      draggable={drag}
      onDragStart={drag ? (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.id); onDragStart!(b.id); } : undefined}
      onDragEnd={drag ? onDragEnd : undefined}
      data-testid="bid-card" data-guide="bids.card" data-bid={b.id}
      // The whole card opens the bid: the title link stretches over the card (after:inset-0), and the menu and
      // next-action button sit above it (relative z-10), so they keep their own clicks. Drag still moves the card.
      className="card-link-host group relative cursor-pointer rounded-lg border border-line bg-surface p-2.5 shadow-sm transition-[border-color,box-shadow] hover:border-brand/50 hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-snug text-ink" data-testid="card-customer">{b.customer || "No customer yet"}</p>
          <Link
            href={`/estimates/${b.id}`} draggable={false} data-card-link data-testid="card-link" title={b.title}
            className="line-clamp-1 break-words text-xs font-medium leading-snug text-ink-soft group-hover:text-brand after:absolute after:inset-0 after:rounded-lg after:content-['']"
          >{b.title}</Link>
        </div>
        <MoveMenu b={b} col={col} onMove={onMove} onDelete={onDelete} />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="tabular truncate text-sm font-extrabold text-navy">{value === null ? <span className="text-xs font-semibold text-muted">Not priced yet</span> : money(value, true)}</span>
        <span className="shrink-0 text-[11px] text-muted" title={new Date(lastActivity(b)).toLocaleString()}>{relDay(lastActivity(b))}</span>
      </div>
      {(b.signing?.state && b.signing.state !== "none" || approval?.kind === "manual") && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
          <SignBadge b={b} />
          {approval?.kind === "manual" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 font-bold text-brand" data-testid="manual-approval">
              <UserCheck className="h-3 w-3" aria-hidden />Approved manually{approval.at ? ` ${new Date(approval.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
            </span>
          )}
        </div>
      )}
      {col === "lost" && b.lostReason && <p className="mt-1 line-clamp-1 text-xs text-ink-soft" title={b.lostReason}>Reason: {b.lostReason}</p>}
      {/* Wraps instead of overflowing when a long action meets a narrow column. */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="whitespace-nowrap text-[11px] text-muted">#{b.number}</span>
        {action && (action.href ? (
          <Link href={action.href} draggable={false} className="relative z-10 ml-auto inline-flex min-h-8 max-w-full items-center gap-1 rounded-md bg-brand-tint px-2 text-xs font-bold text-navy hover:bg-accent-tint" data-testid="next-action">{action.label}<ArrowRight className="h-3 w-3" aria-hidden /></Link>
        ) : (
          <button type="button" onClick={() => onMove(b, action.move!)} className="relative z-10 ml-auto inline-flex min-h-8 max-w-full items-center gap-1 rounded-md bg-accent px-2 text-xs font-bold text-navy hover:bg-accent-hover" data-testid="next-action">{action.label}<ArrowRight className="h-3 w-3" aria-hidden /></button>
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

function MoveMenu({ b, col, onMove, onDelete }: { b: BoardBid; col: Column; onMove: (b: BoardBid, to: Column) => void; onDelete?: (b: BoardBid) => void }) {
  const action = nextAction(b, false, isPmEnabled());
  const blocked = deleteBlock(b);
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={`Move ${b.title}`} className="relative z-10 -mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-black/5 hover:text-navy" data-testid="move-menu" data-guide="bids.card-menu">
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
          {/* Job cards whose primary action opens the schedule keep a one-click link to the project too. */}
          {b.scheduleId && isPmEnabled() && action?.href !== `/projects/${b.scheduleId}` && <Menu.Item asChild><Link href={`/projects/${b.scheduleId}`} className="flex min-h-10 items-center rounded-md px-2 text-sm outline-none data-[highlighted]:bg-brand-tint">Open project</Link></Menu.Item>}
          {onDelete && (
            <>
              <Menu.Separator className="my-1 h-px bg-line" />
              {/* Blocked bids keep the item (disabled, with the reason) so people learn why instead of hunting for it. */}
              <Menu.Item disabled={Boolean(blocked)} onSelect={() => onDelete(b)} title={blocked ?? "Hide this bid. It stays in the audit log and can be restored."} data-testid="delete-bid"
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-danger outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-muted data-[highlighted]:bg-danger-tint">
                <Trash2 className="h-4 w-4" aria-hidden />Delete bid
              </Menu.Item>
              {blocked && <p className="max-w-64 px-2 pb-1 text-xs text-muted" data-testid="delete-blocked">{blocked}</p>}
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
