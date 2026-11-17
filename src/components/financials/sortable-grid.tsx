"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SortableItem { key: string; node: ReactNode; title: string; fixed?: boolean }

const HOLD_MS = 450;     // press and hold this long to pick an item up
const SLOP_PX = 8;       // moving further than this before the hold ends is a scroll or a click, not a drag

/**
 * Press and hold an item, then drag it to a new spot (touch, pen or mouse). The items stay real links and
 * buttons: a quick tap still opens them, and the click that ends a drag is swallowed. The list reorders as
 * the item passes over the others; letting go calls onCommit with the new order (Escape puts it back).
 * Fixed items (locked by the company) can't be picked up. Keyboard users reorder in "Customize this page".
 */
export function SortableGrid({ items, onCommit, className, label, testId }: {
  items: SortableItem[];
  onCommit: (keys: string[]) => Promise<string | null>;
  className?: string;
  label: string;
  testId?: string;
}) {
  const sig = items.map((i) => i.key).join("|");
  const [order, setOrder] = useState(() => items.map((i) => i.key));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "danger" | "info"; text: string } | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const orderRef = useRef(order);
  const press = useRef<{ key: string; x: number; y: number; pointerId: number; timer: number; active: boolean; start: string[] } | null>(null);
  const swallowClick = useRef(false);
  useEffect(() => { orderRef.current = order; }, [order]);

  // A refresh after saving (or someone else's change) brings a new server order: adopt it during render.
  const [seen, setSeen] = useState(sig);
  if (seen !== sig && !dragKey) { setSeen(sig); setOrder(items.map((i) => i.key)); }

  const byKey = new Map(items.map((i) => [i.key, i] as const));

  const end = useCallback(async (commit: boolean) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (!p.active) return;
    // The click that follows letting go must not open the card; if no click comes, forget it shortly after.
    swallowClick.current = true;
    window.setTimeout(() => { swallowClick.current = false; }, 400);
    setDragKey(null);
    const next = orderRef.current;
    if (!commit) { setOrder(p.start); return; }
    if (next.join("|") === p.start.join("|")) return;
    setStatus({ tone: "info", text: "Saving…" });
    const err = await onCommit(next);
    if (err) { setOrder(p.start); setStatus({ tone: "danger", text: err }); }
    else setStatus({ tone: "ok", text: "Saved for you." });
  }, [onCommit]);

  // While dragging: stop the page from scrolling under a finger, and let Escape cancel.
  useEffect(() => {
    if (!dragKey) return;
    const stopScroll = (e: TouchEvent) => { if (press.current?.active) e.preventDefault(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void end(false); };
    document.addEventListener("touchmove", stopScroll, { passive: false });
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("touchmove", stopScroll); document.removeEventListener("keydown", onKey); };
  }, [dragKey, end]);

  useEffect(() => () => { if (press.current) window.clearTimeout(press.current.timer); }, []);

  const onPointerDown = (key: string) => (e: React.PointerEvent<HTMLElement>) => {
    swallowClick.current = false;   // a new press: any click from the last drag is long gone
    if (byKey.get(key)?.fixed || (e.pointerType === "mouse" && e.button !== 0) || press.current) return;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const timer = window.setTimeout(() => {
      const p = press.current;
      if (!p || p.key !== key) return;
      p.active = true;
      try { el.setPointerCapture(pointerId); } catch { /* pointer already gone */ }
      setDragKey(key);
      setStatus({ tone: "info", text: "Drag to a new spot, then let go. Esc puts it back." });
      navigator.vibrate?.(10);
    }, HOLD_MS);
    press.current = { key, x: e.clientX, y: e.clientY, pointerId, timer, active: false, start: orderRef.current };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (!p.active) {
      // Moved before the hold finished: it's a scroll or a normal click, so stand down.
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP_PX) { window.clearTimeout(p.timer); press.current = null; }
      return;
    }
    e.preventDefault();
    for (const [k, el] of els.current) {
      if (k === p.key || byKey.get(k)?.fixed) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
      setOrder((cur) => {
        const from = cur.indexOf(p.key), to = cur.indexOf(k);
        if (from < 0 || to < 0 || from === to) return cur;
        const next = [...cur];
        next.splice(from, 1);
        next.splice(to, 0, p.key);
        return next;
      });
      break;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => { if (press.current && e.pointerId === press.current.pointerId) void end(true); };
  const onPointerCancel = (e: React.PointerEvent<HTMLElement>) => { if (press.current && e.pointerId === press.current.pointerId) void end(false); };

  return (
    <div>
      <ul className={cn(className, dragKey && "cursor-grabbing")} aria-label={label} data-testid={testId} data-dragging={dragKey ?? undefined}>
        {order.map((k) => {
          const it = byKey.get(k);
          if (!it) return null;
          const lifted = dragKey === k;
          return (
            <li key={k} ref={(el) => { if (el) els.current.set(k, el); else els.current.delete(k); }}
              data-sort-key={k}
              className={cn("min-w-0 select-none [-webkit-touch-callout:none] transition-transform duration-150",
                lifted && "relative z-10 scale-[1.03] rounded-xl shadow-lg ring-2 ring-accent",
                dragKey && !lifted && "opacity-90")}
              onPointerDown={onPointerDown(k)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
              onContextMenu={(e) => { if (press.current || dragKey) e.preventDefault(); }}
              onDragStart={(e) => e.preventDefault()}
              onClickCapture={(e) => { if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); e.stopPropagation(); } }}>
              {it.node}
            </li>
          );
        })}
      </ul>
      <p className={cn("mt-1 min-h-5 text-xs", status?.tone === "danger" ? "text-danger" : "text-muted")} role="status" aria-live="polite">
        {status?.text ?? "Tip: press and hold to drag into a new order."}
      </p>
    </div>
  );
}
