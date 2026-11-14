"use client";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal } from "../builder/dialogs";
import { AuthDialog } from "../auth/auth-dialog";
import { Button } from "../ui/button";
import { ANNUAL_MONTHLY_EQUIVALENT, isPlanId, planDisplay, type PlanId } from "@/lib/billing/plans";
import { clearCheckoutLock, clearIntent, readIntent, resumePath, saveIntent, updateIntent } from "@/lib/billing/checkout-intent";
import { startCheckout } from "@/lib/billing/start-checkout";
import { CheckoutFlowContext } from "./checkout-context";
import { formatPhone, samePhone } from "@/lib/auth/phone";

type ResumeReason = "cancelled" | "back" | "closed" | "mismatch" | "expired";
type Phase =
  | { k: "idle" }
  | { k: "auth"; plan: PlanId; email?: string; phone?: string }
  | { k: "redirecting"; plan: PlanId }
  | { k: "failed"; plan: PlanId; message: string }
  | { k: "resume"; plan: PlanId; reason: ResumeReason }
  | { k: "subscribed" }
  | { k: "cancelled_no_plan" };

/** The plan being bought, exactly as Stripe will charge it. */
export function PlanSummary({ plan, onChange, compact }: { plan: PlanId; onChange?: (p: PlanId) => void; compact?: boolean }) {
  const d = planDisplay(plan);
  return (
    <div className={`rounded-xl border border-line bg-paper ${compact ? "p-3" : "p-4"}`} aria-label="Your plan">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Your plan</p>
          <p className="mt-0.5 font-display text-lg font-extrabold leading-tight">{d.name}</p>
        </div>
        <p className="shrink-0 text-right"><span className="font-display text-xl font-extrabold">{d.price}</span><span className="text-sm font-semibold text-muted">{d.per}</span></p>
      </div>
      <ul className="mt-2 space-y-0.5 text-sm text-ink-soft">
        <li>{d.billing}{plan === "monthly" ? ". Cancel anytime." : `: ${d.price} charged once a year.`}</li>
        {plan === "annual" && <li>Equivalent to {ANNUAL_MONTHLY_EQUIVALENT}/month.</li>}
      </ul>
      {onChange && (
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-surface p-1 text-sm ring-1 ring-line" role="radiogroup" aria-label="Change plan">
          {(["monthly", "annual"] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={plan === p} onClick={() => onChange(p)}
              className={`min-h-10 rounded-md px-2 font-semibold transition-colors ${plan === p ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5"}`}>
              {p === "monthly" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SecureNote = () => (
  <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted"><Lock className="h-3.5 w-3.5 shrink-0" aria-hidden /> Secure payment by Stripe. Review before you pay.</p>
);

/**
 * Hosts the pricing-page purchase flow:
 * pick plan → (verify phone or email in a modal, plan kept) → Stripe Checkout, with no second selection.
 * The code is entered in this window, so the plan never leaves this page. It is also kept in localStorage
 * (refreshes) and in the email link's return URL (links opened elsewhere); see checkout-intent.ts.
 */
export function CheckoutFlowProvider({ signedIn: signedInProp, subscribed, userEmail: userEmailProp, userPhone: userPhoneProp = null, children }: { signedIn: boolean; subscribed: boolean; userEmail: string | null; userPhone?: string | null; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [signedIn, setSignedIn] = useState(signedInProp);
  const [userEmail, setUserEmail] = useState(userEmailProp);
  const [userPhone, setUserPhone] = useState(userPhoneProp);
  const userLabel = userEmail ?? (userPhone ? formatPhone(userPhone) : null);
  const started = useRef(false);
  const router = useRouter();

  const begin = useCallback(async (plan: PlanId) => {
    setPhase({ k: "redirecting", plan });
    const r = await startCheckout(plan);
    if (r.kind === "redirecting") return;
    if (r.kind === "already_subscribed") { clearIntent(); router.push("/settings/billing?notice=already_subscribed"); return; }
    if (r.kind === "signed_out") { setSignedIn(false); setPhase({ k: "auth", plan }); return; }
    if (r.kind === "busy") { setPhase({ k: "failed", plan, message: "Checkout is already opening in another tab. If nothing opened, continue here." }); return; }
    setPhase({ k: "failed", plan, message: r.message });
  }, [router]);

  const choose = useCallback((plan: PlanId) => {
    if (subscribed) { router.push("/settings/billing?notice=already_subscribed"); return; }
    saveIntent(plan);
    if (!signedIn) setPhase({ k: "auth", plan });
    else void begin(plan);
  }, [subscribed, signedIn, begin, router]);

  const continueWith = useCallback((plan: PlanId) => {
    clearCheckoutLock();
    saveIntent(plan);
    if (signedIn) void begin(plan);
    else { const i = readIntent().intent; setPhase({ k: "auth", plan, email: i?.email, phone: i?.phone }); }
  }, [signedIn, begin]);

  // Resume a pending purchase once, on arrival (after email-link sign-in, a refresh, or a cancelled checkout).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const sp = new URLSearchParams(window.location.search);
    const resumeParam = sp.get("resume") ?? sp.get("upgrade");
    const cancelled = sp.get("checkout") === "cancelled";
    const planParam = sp.get("plan");
    if (resumeParam || cancelled || planParam) {
      // Drop one-shot params so Back/refresh never re-triggers an automatic redirect.
      for (const k of ["resume", "upgrade", "checkout", "plan"]) sp.delete(k);
      const qs = sp.toString();
      window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    }
    const { intent, expired } = readIntent();
    // State updates below run after the effect so React batches them with the first paint.
    const run = (fn: () => void) => queueMicrotask(fn);

    if (cancelled) {
      clearCheckoutLock();
      const plan = isPlanId(planParam) ? planParam : intent?.plan;
      if (plan) { saveIntent(plan); updateIntent({ status: "cancelled" }); run(() => setPhase({ k: "resume", plan, reason: "cancelled" })); }
      else run(() => setPhase({ k: "cancelled_no_plan" }));
      return;
    }
    if (subscribed) {
      if (resumeParam || intent) { clearIntent(); run(() => setPhase({ k: "subscribed" })); }
      return;
    }
    const plan = isPlanId(resumeParam) ? resumeParam : intent?.plan;
    if (!plan) {
      if (expired) run(() => setPhase({ k: "resume", plan: expired.plan, reason: "expired" }));
      return;
    }
    if (signedInProp) {
      const auto = Boolean(resumeParam) || intent?.status === "pending";
      const mismatch = (intent?.email && userEmailProp && intent.email.toLowerCase() !== userEmailProp.toLowerCase())
        || (intent?.phone && userPhoneProp && !samePhone(intent.phone, userPhoneProp));
      if (mismatch) run(() => setPhase({ k: "resume", plan, reason: "mismatch" }));
      else if (auto) { if (!intent || intent.plan !== plan) saveIntent(plan); run(() => void begin(plan)); }
      else run(() => setPhase({ k: "resume", plan, reason: "back" }));
    } else if (intent?.status === "pending" || resumeParam) {
      // Refreshed mid-verification (or the email link failed): reopen verification with the same plan.
      run(() => setPhase({ k: "auth", plan, email: intent?.email, phone: intent?.phone }));
    } else {
      run(() => setPhase({ k: "resume", plan, reason: "back" }));
    }
  }, [begin, signedInProp, subscribed, userEmailProp, userPhoneProp]);

  // Back from Stripe restores this page from the browser cache, still showing "redirecting".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      clearCheckoutLock();
      setPhase((p) => (p.k === "redirecting" ? { k: "resume", plan: p.plan, reason: "back" } : p));
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const ctx = useMemo(() => ({ choose }), [choose]);
  const name = (p: PlanId) => planDisplay(p).name;

  return (
    <CheckoutFlowContext.Provider value={ctx}>
      <div aria-live="polite">
        {phase.k === "resume" && (
          <ResumeBanner plan={phase.plan} reason={phase.reason} userLabel={userLabel} verifiedLabel={(() => { const i = readIntent().intent; return i?.email ?? (i?.phone ? formatPhone(i.phone) : undefined); })()}
            onContinue={() => continueWith(phase.plan)}
            onDismiss={() => { clearIntent(); setPhase({ k: "idle" }); }} />
        )}
        {phase.k === "subscribed" && (
          <div className="mx-auto mt-6 max-w-xl rounded-xl border border-ok/30 bg-ok-tint px-4 py-3 text-sm" role="status">
            <p className="font-semibold">You already have Unlimited</p>
            <p className="mt-1 text-ink-soft">We didn&apos;t start a new checkout, so you won&apos;t be charged twice. <Link href="/settings/billing" className="font-semibold text-brand underline">Manage your subscription</Link></p>
          </div>
        )}
        {phase.k === "cancelled_no_plan" && (
          <div className="mx-auto mt-6 max-w-xl rounded-xl border border-line bg-surface px-4 py-3 text-sm" role="status">Checkout was cancelled. You have not been charged.</div>
        )}
      </div>

      {children}

      {phase.k === "auth" && (
        <AuthDialog
          key={`auth-${phase.email ?? ""}-${phase.phone ?? ""}`}
          open
          onOpenChange={(o) => { if (!o) setPhase({ k: "resume", plan: phase.plan, reason: "closed" }); }}
          next={resumePath(phase.plan)}
          initialEmail={phase.email}
          initialPhone={phase.phone}
          onEmailSent={(email) => { updateIntent({ email, phone: undefined }); }}
          onPhoneSent={(phone) => { updateIntent({ phone, email: undefined }); }}
          copy={{
            title: "You're almost there!",
            emailDescription: `Verify your email to continue with ${name(phase.plan)}.`,
            sentDescription: (email) => `We sent a 6-digit code to ${email}. Enter it to continue with ${name(phase.plan)}.`,
            phoneDescription: `Verify your mobile number to continue with ${name(phase.plan)}. Your plan stays selected.`,
            phoneSentDescription: (phone) => `We texted a 6-digit code to ${phone}. Enter it here to continue with ${name(phase.plan)}.`,
            submitLabel: "Verify and continue",
          }}
          summary={<div className="mb-4"><PlanSummary plan={phase.plan} compact onChange={(p) => { saveIntent(p); setPhase((cur) => (cur.k === "auth" ? { ...cur, plan: p } : cur)); }} /></div>}
          onVerified={async () => {
            const i = readIntent().intent;
            setSignedIn(true);
            if (i?.email) setUserEmail(i.email);
            if (i?.phone) setUserPhone(i.phone);
            await begin(phase.plan);
          }}
          footer={<SecureNote />}
        />
      )}

      {(phase.k === "redirecting" || phase.k === "failed") && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setPhase({ k: "resume", plan: phase.plan, reason: "closed" }); }}
          title={phase.k === "redirecting" ? "Taking you to secure checkout" : "Checkout didn't open"}
          description={phase.k === "redirecting" ? "One moment while we open Stripe's secure payment page." : "Your plan is still selected. Nothing has been charged."}
        >
          <PlanSummary plan={phase.plan} compact />
          {userLabel && <p className="mt-3 text-sm text-ink-soft">Signed in as <b className="break-all">{userLabel}</b></p>}
          {phase.k === "redirecting" ? (
            <p className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening checkout…</p>
          ) : (
            <div className="mt-4 space-y-3">
              <p role="alert" className="rounded-lg border border-danger/30 bg-danger-tint px-4 py-3 text-sm">{phase.message}</p>
              <Button size="lg" variant="accent" className="w-full" onClick={() => continueWith(phase.plan)}><ShieldCheck className="h-4 w-4" aria-hidden /> Continue to secure checkout</Button>
              <Button variant="ghost" className="w-full" onClick={() => { clearIntent(); setPhase({ k: "idle" }); }}>Choose a different plan</Button>
            </div>
          )}
          <SecureNote />
        </Modal>
      )}
    </CheckoutFlowContext.Provider>
  );
}

function ResumeBanner({ plan, reason, userLabel, verifiedLabel, onContinue, onDismiss }: { plan: PlanId; reason: ResumeReason; userLabel: string | null; verifiedLabel?: string; onContinue: () => void; onDismiss: () => void }) {
  const d = planDisplay(plan);
  const lead = {
    cancelled: "Checkout was cancelled. You have not been charged.",
    back: "You haven't finished checking out.",
    closed: "You haven't finished checking out.",
    expired: "Your earlier plan selection expired.",
    mismatch: `You're signed in as ${userLabel ?? "a different account"}, but you verified ${verifiedLabel ?? "another account"}.`,
  }[reason];
  const tail = reason === "expired" ? `Continue with ${d.name}, or choose a plan below.` : reason === "mismatch" ? `Continue as ${userLabel}, or sign out and verify the other one.` : `Your ${d.name} selection is saved.`;
  return (
    <div className="mx-auto mt-6 max-w-2xl rounded-2xl border-2 border-accent bg-surface p-4 shadow-sm sm:p-5" role="status">
      <p className="font-semibold">{lead}</p>
      <p className="mt-0.5 text-sm text-ink-soft">{tail}</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm"><b>{d.name}</b> · {d.price}{d.per} · {d.billing.toLowerCase()}</div>
        <Button size="lg" variant="accent" className="w-full sm:w-auto" onClick={onContinue}><ShieldCheck className="h-4 w-4" aria-hidden /> Continue to secure checkout</Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 text-sm">
        <button type="button" className="min-h-11 text-brand underline" onClick={onDismiss}>Choose a different plan</button>
        {reason === "mismatch" && <form action="/auth/signout" method="post"><button type="submit" className="min-h-11 text-brand underline">Sign out</button></form>}
      </div>
    </div>
  );
}
