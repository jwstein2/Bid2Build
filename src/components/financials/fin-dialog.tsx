"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/** A dialog the person opened on purpose (never an unprompted popup). Full-height sheet on phones. */
export function FinDialog({ open, onOpenChange, title, description, children, wide, preview }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; wide?: boolean; preview?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={preview ? "motion-fade fixed inset-0 z-50 bg-ink/55 backdrop-blur-md" : "fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]"} />
        <Dialog.Content
          className={`app-theme fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 text-ink shadow-2xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6 ${preview ? "motion-reveal sm:max-w-3xl" : wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
          <Dialog.Title className="pr-10 font-display text-xl font-extrabold">{title}</Dialog.Title>
          {description ? <Dialog.Description className="mt-1 text-sm text-ink-soft">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
          <div className="mt-4">{children}</div>
          <Dialog.Close className="absolute right-3 top-3 grid min-h-11 min-w-11 place-items-center rounded-lg text-muted hover:bg-black/5" aria-label="Close"><X className="h-5 w-5" aria-hidden /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
