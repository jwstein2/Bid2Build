"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Right-side panel on desktop, full screen on phones. Escape / overlay click close it (Radix). */
export function Drawer({ open, onOpenChange, title, subtitle, children, wide = false, testId, guide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; wide?: boolean; testId?: string; guide?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="metric-drawer-overlay fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content
          className={`metric-drawer fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto border-l border-line bg-surface text-ink shadow-2xl ${wide ? "max-w-2xl" : "max-w-xl"}`}
          data-testid={testId} data-guide={guide} aria-describedby={undefined}>
          <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3 sm:px-6">
            <Dialog.Title className="pr-10 font-display text-lg font-extrabold text-navy">{title}</Dialog.Title>
            {subtitle && <div className="mt-0.5 text-sm text-ink-soft">{subtitle}</div>}
            <Dialog.Close className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-md text-muted hover:bg-black/5 hover:text-ink" aria-label="Close"><X className="h-5 w-5" aria-hidden /></Dialog.Close>
          </div>
          <div className="flex-1 space-y-5 px-4 py-4 sm:px-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
