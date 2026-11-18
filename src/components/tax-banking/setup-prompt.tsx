"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Landmark, Receipt } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

const KEY = "b2b.tb-setup-later";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

/** Financials onboarding: tax setup + "Connect Business Bank Account / I'll Do This Later". "Later" hides it on this device. */
export function TaxBankSetupPrompt({ needsTax, needsBank }: { needsTax: boolean; needsBank: boolean }) {
  const hidden = useSyncExternalStore(subscribe, read, () => true);
  if (hidden || (!needsTax && !needsBank)) return null;
  return (
    <section aria-labelledby="tb-setup-h" className="rounded-xl border border-line bg-surface p-4" data-testid="tb-setup-prompt">
      <h2 id="tb-setup-h" className="font-display text-base font-extrabold">Finish setting up cash and tax</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {needsTax && <Link href="/financials/tax?view=setup" className={buttonClass("secondary", "sm")}><Receipt className="h-4 w-4" aria-hidden /> Set up sales tax</Link>}
        {needsBank && <Link href="/financials/banks?onboarding=1" className={buttonClass("primary", "sm")}><Landmark className="h-4 w-4" aria-hidden /> Connect Business Bank Account</Link>}
        <button type="button" className="min-h-9 px-2 text-sm font-semibold text-accent-ink underline" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ } listeners.forEach((f) => f()); }}>I&apos;ll do this later</button>
      </div>
      <p className="mt-2 text-xs text-muted">Bank access is read-only. Built2Bid never asks for your bank login and can&apos;t move money.</p>
    </section>
  );
}
