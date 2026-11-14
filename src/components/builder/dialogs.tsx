"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, X } from "lucide-react";
import { type ReactNode } from "react";
import { plans } from "@/lib/site";
import { Button } from "../ui/button";
import { CheckoutButton } from "../billing/checkout-button";

export function Modal({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]" />
        <Dialog.Content className={`fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl sm:p-6 ${wide ? "max-w-2xl" : "max-w-md"}`}>
          <Dialog.Title className="pr-8 font-display text-xl font-extrabold">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-1 text-ink-soft">{description}</Dialog.Description>}
          <div className="mt-4">{children}</div>
          <Dialog.Close className="absolute right-4 top-4 rounded p-1 text-muted hover:bg-black/5" aria-label="Close"><X className="h-5 w-5" /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function UpgradeDialog({ open, onOpenChange, nextCycleAt }: { open: boolean; onOpenChange: (o: boolean) => void; nextCycleAt?: string }) {
  const next = nextCycleAt ? new Date(nextCycleAt).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;
  const perks = ["Unlimited finalized bids", "Reusable proposal templates", "Full proposal customization", "Same features on monthly or annual"];
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="You've used your free bids" description="Your estimate is saved. Go Unlimited to finalize it now and every bid after it." wide>
      <div className="relative overflow-hidden rounded-xl bg-navy p-5 text-white on-dark">
        <div aria-hidden className="blueprint-grid-dark pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative grid gap-4 sm:grid-cols-[1.2fr_1fr] sm:items-center">
          <ul className="space-y-2 text-sm text-[#D5DFE9]">
            {perks.map((p) => <li key={p} className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-teal" strokeWidth={3} aria-hidden />{p}</li>)}
          </ul>
          <div className="grid gap-2">
            <div className="rounded-lg border-2 border-accent bg-white/5 p-3">
              <p className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-accent">Annual <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-navy">Save ~{plans.annualSavingsPercent}%</span></p>
              <p className="mt-1 font-display text-2xl font-extrabold">{plans.annualPriceLabel}<span className="text-sm font-semibold text-[#B8C6D4]">/year</span></p>
              <p className="text-xs text-[#D5DFE9]">Billed annually · equivalent to {plans.annualMonthlyEquivalent}/month</p>
            </div>
            <div className="rounded-lg border border-white/20 p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-[#B8C6D4]">Monthly</p>
              <p className="mt-1 font-display text-xl font-extrabold">{plans.monthlyPriceLabel}<span className="text-sm font-semibold text-[#B8C6D4]">/month</span></p>
              <p className="text-xs text-[#D5DFE9]">Billed monthly · cancel anytime</p>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <CheckoutButton plan="annual" signedIn label="Go Unlimited Annual" />
        <CheckoutButton plan="monthly" signedIn label="Go Unlimited Monthly" variant="secondary" />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted">{next ? `Or wait: your next free monthly bid arrives ${next}.` : "Drafts and previews stay free."}</p>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Keep editing</Button>
      </div>
    </Modal>
  );
}
