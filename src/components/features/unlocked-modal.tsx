"use client";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Modal } from "@/components/builder/dialogs";
import { Button } from "@/components/ui/button";
import type { Feature } from "@/lib/features/registry";
import { FEATURE_ICONS } from "./icons";

/**
 * "Your New Features Are Ready": shown once after an upgrade (or once when a release adds premium
 * features an account already pays for). Lists only features the account's access actually includes.
 */
export function UnlockedModal({ features, onExplore, onLater, onClose }: { features: Feature[]; onExplore: () => void; onLater: () => void; onClose: () => void }) {
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Your New Features Are Ready" description="These are now included with your plan.">
      <div data-testid="unlocked-modal">
        <ul className="space-y-3">
          {features.map((f) => {
            const Icon = FEATURE_ICONS[f.id];
            return (
              <li key={f.id} className="flex gap-3" data-testid="unlocked-feature">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-ink"><Icon className="h-5 w-5" aria-hidden /></span>
                <span className="min-w-0">
                  <span className="block font-semibold text-navy">{f.name}</span>
                  <span className="block text-sm text-ink-soft">{f.description}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onLater}>Maybe Later</Button>
          <Button variant="primary" onClick={onExplore}><Sparkles className="h-4 w-4" aria-hidden /> Explore Features</Button>
        </div>
        <p className="mt-3 text-xs text-muted">You can find these any time on <Link href="/whats-new" className="font-semibold text-accent-ink underline" onClick={onLater}>What&apos;s New</Link>.</p>
      </div>
    </Modal>
  );
}
