"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Loader2, Mail, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { plans } from "@/lib/site";
import { Button } from "../ui/button";
import { CheckoutButton } from "../billing/checkout-button";
import { Notice } from "../ui/misc";

export function Modal({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]" />
        <Dialog.Content className={`fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl ${wide ? "max-w-2xl" : "max-w-md"}`}>
          <Dialog.Title className="font-display text-xl font-extrabold">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-1 text-ink-soft">{description}</Dialog.Description>}
          <div className="mt-4">{children}</div>
          <Dialog.Close className="absolute right-4 top-4 rounded p-1 text-muted hover:bg-black/5" aria-label="Close"><X className="h-5 w-5" /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AuthDialog({ open, onOpenChange, next, onVerified, title }: { open: boolean; onOpenChange: (o: boolean) => void; next: string; onVerified?: () => void; title?: string }) {
  const [email, setEmail] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [stage, setStage] = useState<"email" | "sent">("email");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const supabase = getBrowserClient();

  async function send() {
    if (!supabase) { setErr("Accounts aren't configured on this server yet."); return; }
    setBusy(true); setErr(null);
    const redirect = new URL("/auth/callback", window.location.origin);
    redirect.searchParams.set("next", next);
    if (marketing) redirect.searchParams.set("marketing", "1");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect.toString(), shouldCreateUser: true } });
    setBusy(false);
    if (error) setErr(error.message.includes("rate") ? "Too many attempts. Please wait a minute and try again." : "We couldn't send the email. Check the address and try again.");
    else setStage("sent");
  }
  async function verify() {
    if (!supabase) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) { setErr("That code didn't work. Check the latest email or request a new one."); return; }
    if (marketing) await fetch("/api/account/marketing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ optIn: true }) }).catch(() => {});
    onVerified?.();
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={stage === "email" ? (title ?? "Create your free account to download") : "Check your email"} description={stage === "email" ? `No password needed. Your bid is saved and will be waiting. ${plans.starterCredits} free bids to start, plus ${plans.monthlyCredits} every month.` : `We sent a sign-in link and code to ${email}.`}>
      {stage === "email" ? (
        <form onSubmit={(ev) => { ev.preventDefault(); send(); }} className="space-y-3">
          <label htmlFor="auth-email" className="label">Business email</label>
          <input id="auth-email" type="email" required autoFocus autoComplete="email" className="field" value={email} onChange={(ev) => setEmail(ev.target.value)} />
          <p className="text-xs text-muted">We use your email to verify your account and send sign-in links and receipts.</p>
          <label className="flex items-start gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={marketing} onChange={(ev) => setMarketing(ev.target.checked)} className="mt-1 accent-[var(--color-brand)]" />
            <span>Also send me occasional product tips and offers (optional, unsubscribe anytime).</span>
          </label>
          {err && <Notice tone="danger">{err}</Notice>}
          <Button type="submit" className="w-full" size="lg" disabled={busy || !email.includes("@")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Email me a sign-in link</Button>
          <p className="text-center text-xs text-muted">By continuing you agree to the <Link href="/terms" className="underline" target="_blank">Terms</Link> and <Link href="/privacy" className="underline" target="_blank">Privacy Policy</Link>.</p>
        </form>
      ) : (
        <form onSubmit={(ev) => { ev.preventDefault(); verify(); }} className="space-y-3">
          <p className="text-sm text-ink-soft">Click the link in the email, or enter the 6-digit code here. Keep this tab open; your bid is saved on this device.</p>
          <label htmlFor="auth-code" className="label">Verification code</label>
          <input id="auth-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} className="field tabular text-center text-lg tracking-[0.4em]" value={code} onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ""))} />
          {err && <Notice tone="danger">{err}</Notice>}
          <Button type="submit" className="w-full" size="lg" disabled={busy || code.length < 6}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify and continue</Button>
          <button type="button" className="w-full text-center text-sm text-brand underline" onClick={() => { setStage("email"); setCode(""); }}>Use a different email or resend</button>
        </form>
      )}
    </Modal>
  );
}

export function UpgradeDialog({ open, onOpenChange, nextCycleAt }: { open: boolean; onOpenChange: (o: boolean) => void; nextCycleAt?: string }) {
  const next = nextCycleAt ? new Date(nextCycleAt).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;
  const perks = ["Unlimited finalized bids", "Reusable proposal templates", "Full proposal customization", "Cancel anytime"];
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
              <p className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-accent">Annual <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-navy">Save 38%</span></p>
              <p className="mt-1 font-display text-2xl font-extrabold">{plans.annualPriceLabel}<span className="text-sm font-semibold text-[#B8C6D4]">/year</span></p>
              <p className="text-xs text-[#B8C6D4]">Just {plans.annualMonthlyEquivalent}/month</p>
            </div>
            <div className="rounded-lg border border-white/20 p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-[#B8C6D4]">Monthly</p>
              <p className="mt-1 font-display text-xl font-extrabold">{plans.monthlyPriceLabel}<span className="text-sm font-semibold text-[#B8C6D4]">/month</span></p>
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
