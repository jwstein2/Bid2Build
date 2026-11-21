"use client";
import { Smartphone } from "lucide-react";
import { InstallAppButton } from "@/components/marketing/install-app-button";

/** V8.3.1: on My work, invite the worker to put Built2Bid on their phone's Home Screen (hidden once installed). */
export function InstallMyWork() {
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm" data-testid="install-my-work">
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
        <Smartphone className="h-5 w-5 shrink-0 text-accent-ink" aria-hidden />
        <p className="min-w-0 text-ink-soft">Put Built2Bid on your phone&apos;s Home Screen so My work is one tap away.</p>
      </div>
      <InstallAppButton tone="light" />
    </section>
  );
}
