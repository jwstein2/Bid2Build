"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Clock, Loader2, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { ALL_ACCESS_EXCLUDES, PLAN_META, usd, type AdvPlan } from "@/lib/academy/advanced/plans";

type QuoteView = {
  id: string; kind: "new" | "upgrade" | "convert"; plan: AdvPlan; subjects: { slug: string; title: string }[]; amount_cents: number; stage: number; expires_at: string;
  due_now_cents: number | null; credit_cents: number | null; notes: string[];
};

export type PickerProps = {
  subject: { slug: string; title: string };
  partner: { slug: string; title: string; reason: string | null } | null;
  plans: AdvPlan[];
  recommended: AdvPlan | null;
  prices: Record<AdvPlan, number>;
  signedIn: boolean;
  billing: boolean;
  upgrade: boolean;
  currentPlan: AdvPlan | null;
  ownedSubjectTitle?: string | null;
  className?: string;
};

const minutesLeft = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));

/** "Choose how you want to learn": three simple choices, a server quote, then an explicit accept before payment. */
export function PlanPicker(p: PickerProps) {
  const [busy, setBusy] = useState<AdvPlan | "accept" | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!quote) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [quote]);

  const here = `/academy/advanced/${p.subject.slug}`;
  const login = `/login?next=${encodeURIComponent(here)}`;

  async function choose(plan: AdvPlan) {
    setErr(null); setBusy(plan);
    try {
      const r = await fetch("/api/academy/advanced/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, subject: p.subject.slug }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? "Something went wrong. Please try again.");
      setQuote(j.quote as QuoteView);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function accept() {
    if (!quote) return;
    setErr(null); setBusy("accept");
    try {
      const r = await fetch("/api/academy/advanced/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote: quote.id, accept: true, subject: p.subject.slug }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j?.error?.code === "quote_expired") setQuote(null);
        throw new Error(j?.error?.message ?? "Something went wrong. Please try again.");
      }
      window.location.assign(j.url);
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  }

  if (quote) {
    const meta = PLAN_META[quote.plan];
    const left = minutesLeft(quote.expires_at);
    return (
      <section className={cn("rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6", p.className)} aria-labelledby="confirm-h" data-testid="plan-confirm">
        <h2 id="confirm-h" className="font-display text-xl font-extrabold">Review and confirm</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Package</dt><dd className="font-semibold">{meta.name}</dd></div>
          <div><dt className="text-muted">Monthly price</dt><dd className="font-display text-2xl font-extrabold" data-testid="quote-amount">{usd(quote.amount_cents)}<span className="text-sm font-semibold text-ink-soft">/month + tax</span></dd></div>
          <div className="sm:col-span-2"><dt className="text-muted">Includes</dt><dd className="font-semibold">{quote.plan === "all_access" ? "Every advanced subject, plus one Individual Unlimited seat" : quote.subjects.map((s) => s.title).join(" + ")}</dd></div>
          {quote.due_now_cents !== null && <div><dt className="text-muted">Charged today (prorated)</dt><dd className="font-semibold">{usd(quote.due_now_cents)}</dd></div>}
          {quote.credit_cents !== null && quote.credit_cents > 0 && <div><dt className="text-muted">Credit for unused Individual Unlimited days</dt><dd className="font-semibold">{usd(quote.credit_cents)} off your next invoice</dd></div>}
        </dl>
        {quote.notes.length > 0 && <ul className="mt-4 space-y-2 text-sm text-ink-soft">{quote.notes.map((n) => <li key={n} className="rounded-lg bg-paper px-3 py-2">{n}</li>)}</ul>}
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-soft">
          <li>Billed monthly until you cancel. Sales tax is added where it applies.</li>
          <li>Founding-member rate: your monthly price stays the same while you keep this package without a break. If you cancel or change packages, the price available at that time applies.</li>
          <li>Cancel anytime from Membership. You keep access until the end of the month you paid for. Paid months aren&apos;t refunded. Your progress and your Built2Bid data are never deleted.</li>
          {quote.plan === "all_access" && <li>All Access doesn&apos;t include: {ALL_ACCESS_EXCLUDES.join("; ")}.</li>}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><Clock className="h-3.5 w-3.5" aria-hidden /> This price is held for you for {left} more {left === 1 ? "minute" : "minutes"}.</p>
        {err && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{err}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={accept} disabled={busy !== null || left < 3} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 py-2 font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50" data-testid="accept-quote">
            {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
            {quote.kind === "upgrade" ? `Confirm upgrade to ${usd(quote.amount_cents)}/month` : `Agree and continue to secure checkout`}
          </button>
          <button type="button" onClick={() => { setQuote(null); setErr(null); }} className="text-sm font-semibold text-ink-soft hover:underline">Choose a different option</button>
        </div>
      </section>
    );
  }

  return (
    <section className={cn("rounded-2xl border border-line bg-paper p-4 sm:p-6", p.className)} aria-labelledby="choose-h" data-testid="plan-picker">
      <h2 id="choose-h" className="font-display text-xl font-extrabold">Choose how you want to learn</h2>
      {p.upgrade && <p className="mt-1 text-sm text-ink-soft">You&apos;re a member{p.ownedSubjectTitle ? ` with ${p.ownedSubjectTitle}` : ""}. Add {p.subject.title} by upgrading your package.</p>}
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        {p.plans.map((plan) => {
          const meta = PLAN_META[plan];
          const rec = plan === p.recommended;
          const title = plan === "one_subject" ? `Just ${p.subject.title}` : plan === "two_subjects"
            ? `${p.subject.title} + ${p.upgrade ? p.ownedSubjectTitle ?? "your subject" : p.partner?.title ?? ""}` : meta.name;
          return (
            <li key={plan} className={cn("flex flex-col rounded-xl border bg-surface p-4 shadow-card", rec ? "border-brand ring-2 ring-brand/20" : "border-line")} data-testid={`plan-${plan}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold tracking-wide text-muted uppercase">{meta.short}</span>
                {rec && <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-bold text-navy">Recommended</span>}
              </div>
              <h3 className="mt-1 font-display text-lg leading-snug font-bold">{title}</h3>
              <p className="mt-1 font-display text-2xl font-extrabold">{usd(p.prices[plan])}<span className="text-sm font-semibold text-ink-soft">/month</span></p>
              <p className="text-xs text-muted">Founding-member price</p>
              {plan === "two_subjects" && !p.upgrade && p.partner?.reason && <p className="mt-2 rounded-lg bg-paper px-2.5 py-1.5 text-xs text-ink-soft"><b className="text-ink">Why {p.partner.title}?</b> {p.partner.reason}</p>}
              <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
                {meta.includes.map((i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden /> <span>{i}</span></li>)}
              </ul>
              {plan === "all_access" && <p className="mt-2 text-xs text-muted">Doesn&apos;t include Team or Enterprise plans, extra seats or separately billed add-ons.</p>}
              <div className="mt-auto pt-4">
                {!p.signedIn ? (
                  <Link href={login} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark">Sign in to choose</Link>
                ) : !p.billing ? (
                  <button type="button" disabled className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line-strong px-4 py-2 font-semibold text-ink-soft" data-testid="coming-soon">Coming soon</button>
                ) : (
                  <button type="button" onClick={() => choose(plan)} disabled={busy !== null} className={cn("inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 py-2 font-semibold shadow-sm disabled:opacity-60", rec ? "bg-brand text-white hover:bg-brand-dark" : "border border-line-strong bg-surface text-ink hover:bg-paper")} data-testid={`choose-${plan}`}>
                    {busy === plan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : plan === "all_access" ? <Sparkles className="h-4 w-4" aria-hidden /> : null}
                    {p.upgrade ? "Upgrade" : "Choose"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {err && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{err}</p>}
      <p className="mt-4 text-sm text-ink-soft">Not ready? <Link href="/academy/classroom" className="font-semibold text-accent-ink underline">Keep learning free in the Classroom</Link>. Free courses stay free.</p>
    </section>
  );
}
