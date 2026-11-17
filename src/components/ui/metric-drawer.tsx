"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A whole-card button that opens a side drawer for quick inspection (a short record list, a metric's
 * calculation). The open drawer is mirrored in the URL hash (#metric-<id>) so the browser Back button
 * closes it, a refresh reopens it and the link can be shared. The drawer is portaled into the nearest
 * themed root (.cc owner theme or .app-theme), so it inherits Light, Dark and Black tokens.
 */
export function MetricDrawer({ id, title, description, body, className, children, testId }: {
  id: string; title: string; description?: string; body: ReactNode; className?: string; children: ReactNode; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pushed = useRef(false);
  const hash = `#metric-${id}`;

  const locate = useCallback(() => setContainer((trigger.current?.closest(".cc, .app-theme") as HTMLElement | null) ?? null), []);

  useEffect(() => {
    const sync = () => {
      const want = window.location.hash === hash;
      if (want) locate();
      setOpen(want);
      if (!want) pushed.current = false;
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); };
  }, [hash, locate]);

  const change = (next: boolean) => {
    if (next) {
      locate();
      if (window.location.hash !== hash) { window.history.pushState(null, "", hash); pushed.current = true; }
      setOpen(true);
      return;
    }
    setOpen(false);
    if (window.location.hash !== hash) return;
    if (pushed.current) { pushed.current = false; window.history.back(); }
    else window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Trigger asChild>
        <button ref={trigger} type="button" className={className} data-testid={testId} data-metric-drawer={id} aria-haspopup="dialog">{children}</button>
      </Dialog.Trigger>
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Overlay className="metric-drawer-overlay fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content className="metric-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface p-5 text-ink shadow-2xl sm:p-6" data-testid="metric-drawer">
          <Dialog.Title className="pr-10 font-display text-lg font-extrabold">{title}</Dialog.Title>
          {description ? <Dialog.Description className="mt-1 text-sm text-ink-soft">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Details behind this number</Dialog.Description>}
          <div className="mt-4 min-w-0 flex-1 space-y-4 text-sm">{body}</div>
          <Dialog.Close className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-black/5 hover:text-ink" aria-label="Close"><X className="h-5 w-5" aria-hidden /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
