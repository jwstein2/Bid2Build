"use client";
import { Banknote, Boxes, CalendarRange, Camera, ClipboardList, FilePen, FileSignature, FileText, FlaskConical, HardHat, ListChecks, Mail, Package, Receipt, ReceiptText, Shield, Store, Truck, User, Wallet, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { SearchKind, SearchResult, Tone } from "@/lib/search/kinds";

export const KIND_ICON: Record<SearchKind | "action" | "admin", typeof User> = {
  customer: User, estimate: FileText, project: CalendarRange, task: ListChecks, scope: ClipboardList, change_order: FilePen, signature: FileSignature,
  invoice: Receipt, payment: Banknote, bill: ReceiptText, expense: Wallet, vendor: Store, resource: HardHat, supplier: Truck, saved_item: Package,
  assembly: Boxes, photo: Camera, message: Mail, action: Zap, admin: Shield,
};

const TONE: Record<Tone, string> = {
  neutral: "bg-idle-tint text-ink-soft",
  info: "bg-accent-tint text-accent-dark",
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  danger: "bg-danger-tint text-danger",
};

export function StatusBadge({ status }: { status: SearchResult["status"] }) {
  if (!status) return null;
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-4", TONE[status.tone])}>{status.label}</span>;
}

export function Chip({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return <span title={title} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold leading-4", TONE[tone])}>{children}</span>;
}

export const SandboxChip = () => <Chip tone="warn" title="Practice (sandbox) book: not your real books"><FlaskConical className="h-3 w-3" aria-hidden />Practice</Chip>;

/** Bold the parts of `text` that match the query words (display only; matching happened in the database). */
export function Highlight({ text, words }: { text: string; words: string[] }) {
  const ws = words.filter((w) => w.length >= 2).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ws.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${ws.join("|")})`, "ig"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-accent-tint text-inherit">{p}</mark> : p))}</>;
}

/** One result: what it is, its category, why it matched, who/what it relates to, its status and where it goes. */
export function ResultBody({ r, words }: { r: SearchResult; words: string[] }) {
  const Icon = KIND_ICON[r.kind];
  return (
    <>
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand" aria-hidden><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 break-words font-semibold text-ink"><Highlight text={r.title} words={words} /></span>
          <StatusBadge status={r.status} />
          {r.sandbox && <SandboxChip />}
          {r.inContext && <Chip tone="info">This project</Chip>}
        </span>
        <span className="block text-xs text-ink-soft">
          <span className="font-semibold">{r.kindLabel}</span>
          {r.subtitle ? <> · <Highlight text={r.subtitle} words={words} /></> : null}
        </span>
        {r.reason && <span className="block text-xs text-muted">{r.reason}</span>}
      </span>
      {r.amount && <span className="shrink-0 pl-2 text-sm font-semibold tabular-nums text-ink">{r.amount}</span>}
    </>
  );
}
