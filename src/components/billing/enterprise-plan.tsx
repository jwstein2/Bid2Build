"use client";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button, ButtonLink } from "../ui/button";
import { AuthDialog } from "../auth/auth-dialog";
import { codeRequestedText, emailOtpLength } from "@/lib/auth/config";
import { ENTERPRISE_INCLUDED_USERS, enterpriseQuote, formatCents } from "@/lib/enterprise/pricing";

export const ENTERPRISE_FEATURES = [
  "3 full-access users included",
  "Unlimited bidding",
  "Company management dashboard",
  "Roles and permissions for owners, managers, estimators and viewers",
  "Company-wide bid style with locks",
  "Company-wide bid analytics and sales pipeline",
  "Saved Items & Pricing",
  "Proposal Templates",
  "Centralized user and billing management",
  "Automatic volume discounts on additional users",
];

const MAX_ESTIMATE = 500;
const clampUsers = (n: number) => Math.min(MAX_ESTIMATE, Math.max(ENTERPRISE_INCLUDED_USERS, Number.isFinite(n) ? Math.round(n) : ENTERPRISE_INCLUDED_USERS));
/** Where verification returns to: the Enterprise card, with the seat estimate the visitor chose. */
export const enterpriseReturnPath = (users: number) => `/pricing?plan=enterprise&users=${clampUsers(users)}#enterprise`;

/**
 * Enterprise card: live seat estimate (same pricing module the server bills with) and checkout.
 * `mode` decides the action: open = checkout is live; contact = prices not configured yet;
 * member = already in a company; owner = already the owner (manage instead).
 */
export function EnterprisePlan({ signedIn, mode, supportEmail, extraFeatures = [] }: { signedIn: boolean; mode: "open" | "contact" | "member" | "owner"; supportEmail: string; extraFeatures?: string[] }) {
  const params = useSearchParams();
  // The seat estimate survives sign-in (and a refresh) through the return URL.
  const [users, setUsers] = useState(() => clampUsers(Number(params.get("users") ?? ENTERPRISE_INCLUDED_USERS)));
  const [company, setCompany] = useState("");
  const resumed = params.get("plan") === "enterprise" && signedIn && mode === "open";
  const [open, setOpen] = useState(resumed);
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const companyInput = useRef<HTMLInputElement>(null);
  const q = enterpriseQuote(users);

  // Back from verification: bring the Enterprise card into view with the company step ready.
  useEffect(() => {
    if (!resumed) return;
    document.getElementById("enterprise")?.scrollIntoView({ block: "start" });
    companyInput.current?.focus({ preventScroll: true });
  }, [resumed]);

  async function start() {
    if (!signedIn) { setAuthOpen(true); return; }
    if (!open) { setOpen(true); return; }
    if (!company.trim()) { setErr("Enter your company name."); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/stripe/enterprise-checkout", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: company.trim(), users, attempt: crypto.randomUUID() }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (r?.ok && d?.url) { window.location.assign(d.url); return; }
    setBusy(false);
    if (d?.error?.code === "not_authenticated") setAuthOpen(true);
    else setErr(d?.error?.message ?? "We couldn't start checkout. Please try again.");
  }

  const clamp = clampUsers;

  return (
    <section id="enterprise" aria-labelledby={`${id}-h`} className="mx-auto mt-10 max-w-5xl rounded-2xl border border-navy/20 bg-surface p-4 shadow-sm sm:p-6 md:p-8" data-testid="enterprise-plan">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wide text-accent-ink">For contracting teams</p>
          <h2 id={`${id}-h`} className="mt-1 font-display text-2xl font-extrabold">Enterprise</h2>
          <p className="mt-3 whitespace-nowrap"><span className="font-display text-4xl font-extrabold">$49.99</span><span className="font-semibold text-muted">/month</span></p>
          <p className="mt-1 text-sm font-semibold text-ink">Built for growing contracting teams.</p>
          <p className="mt-2 text-sm text-ink-soft">Includes your primary administrator account plus two additional team members at no extra charge. All three accounts include full access to unlimited bidding.</p>
          <p className="mt-2 text-sm text-ink-soft">Manage your team&apos;s estimates, customers, pipeline, and performance from one powerful company dashboard.</p>
          <ul className="mt-5 space-y-2 text-sm">{[...ENTERPRISE_FEATURES, ...extraFeatures].map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{f}</li>)}</ul>
        </div>
        <div className="min-w-0 rounded-xl bg-paper p-4 sm:p-5">
          <h3 className="font-display font-bold">Additional users</h3>
          <table className="mt-2 w-full text-sm">
            <caption className="sr-only">Enterprise price per additional user</caption>
            <tbody>
              <tr className="border-b border-line"><td className="py-1.5">Users 1–3</td><td className="py-1.5 text-right font-semibold">Included</td></tr>
              <tr className="border-b border-line"><td className="py-1.5">Users 4–5</td><td className="py-1.5 text-right font-semibold">$19.99/user/month</td></tr>
              <tr className="border-b border-line"><td className="py-1.5">Users 6–10 <span className="text-ink-soft">(10% off)</span></td><td className="py-1.5 text-right font-semibold">$17.99/user/month</td></tr>
              <tr><td className="py-1.5">Users 11+ <span className="text-ink-soft">(20% off)</span></td><td className="py-1.5 text-right font-semibold">$15.99/user/month</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-soft">Each discount applies only to the users inside its tier. Every user is an individually licensed person with their own login.</p>

          <div className="mt-5">
            <label htmlFor={`${id}-users`} className="text-sm font-semibold">Estimate your team</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" aria-label="Fewer users" onClick={() => setUsers((u) => clamp(u - 1))} disabled={users <= ENTERPRISE_INCLUDED_USERS}><Minus className="h-4 w-4" /></Button>
              <input id={`${id}-users`} type="number" inputMode="numeric" min={ENTERPRISE_INCLUDED_USERS} max={MAX_ESTIMATE} value={users}
                onChange={(e) => setUsers(clamp(Number(e.target.value)))} className="h-10 w-20 rounded-lg border border-line bg-surface px-3 text-center text-base font-semibold" />
              <Button type="button" variant="secondary" aria-label="More users" onClick={() => setUsers((u) => clamp(u + 1))} disabled={users >= MAX_ESTIMATE}><Plus className="h-4 w-4" /></Button>
              <span className="text-sm text-ink-soft">users</span>
            </div>
            <dl className="mt-3 space-y-1 text-sm" data-testid="enterprise-quote">
              {q.lines.map((l) => (
                <div key={l.label} className="flex justify-between gap-3"><dt className="text-ink-soft">{l.label}{l.users > 0 && l.label.startsWith("Users") ? ` × ${formatCents(l.unitCents)}` : ""}</dt><dd>{formatCents(l.totalCents)}</dd></div>
              ))}
              <div className="flex justify-between gap-3 border-t border-line pt-2 font-bold"><dt>Monthly total</dt><dd data-testid="enterprise-total">{formatCents(q.monthlyCents)}/month</dd></div>
            </dl>
          </div>

          {mode === "open" && open && (
            <div className="mt-4">
              <label htmlFor={`${id}-co`} className="text-sm font-semibold">Company name</label>
              {resumed && <p className="mt-1 text-xs text-ok" role="status">You&apos;re signed in. Add your company name to review checkout.</p>}
              <input ref={companyInput} id={`${id}-co`} value={company} maxLength={200} autoComplete="organization" onChange={(e) => setCompany(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" />
            </div>
          )}
          <div className="mt-5">
            {mode === "owner" ? <ButtonLink href="/company/billing" variant="secondary" size="lg" className="w-full">Manage Enterprise</ButtonLink>
              : mode === "member" ? <p className="text-sm text-ink-soft">You&apos;re part of a company account. Ask your company owner about seats.</p>
              : mode === "contact" ? <ButtonLink href={`mailto:${supportEmail}?subject=${encodeURIComponent("Built2Bid Enterprise")}`} size="lg" className="w-full">Contact us about Enterprise</ButtonLink>
              : <Button size="lg" className="h-auto min-h-12 w-full whitespace-normal py-3" onClick={start} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{open ? `Continue to checkout · ${formatCents(q.monthlyCents)}/month` : "Get Started with Enterprise"}</Button>}
            {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
            <p className="mt-2 text-xs text-ink-soft">Billed monthly, no long-term contract. Added users are prorated; removed users lower your price from the next invoice, with no refund for the current month. Prices in USD; taxes may apply.</p>
          </div>
        </div>
      </div>
      {authOpen && (
        <AuthDialog
          open
          onOpenChange={setAuthOpen}
          next={enterpriseReturnPath(users)}
          copy={{
            title: "Verify your email to continue with Enterprise",
            emailDescription: "No password needed. Your Enterprise selection and team size stay selected. Nothing is charged until you review checkout.",
            sentDescription: (email) => `${codeRequestedText(email, emailOtpLength())} Enter it to continue with Enterprise.`,
            phoneDescription: "Verify your mobile number to continue with Enterprise. Your team size stays selected.",
            phoneSentDescription: (phone) => `We texted a 6-digit code to ${phone}. Enter it here to continue with Enterprise.`,
            submitLabel: "Verify and continue",
          }}
          summary={
            <div className="mb-4 rounded-xl border border-line bg-paper p-3" aria-label="Your plan" data-testid="enterprise-auth-summary">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">Your plan</p>
                  <p className="mt-0.5 font-display text-lg font-extrabold leading-tight">Enterprise</p>
                </div>
                <p className="shrink-0 text-right"><span className="font-display text-xl font-extrabold">{formatCents(q.monthlyCents)}</span><span className="text-sm font-semibold text-muted">/month</span></p>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{users} licensed users ({ENTERPRISE_INCLUDED_USERS} included). Billed monthly; you review the total before paying.</p>
            </div>
          }
          // Full navigation so the server re-checks the account (it may already own or belong to a company).
          onVerified={() => { window.location.assign(enterpriseReturnPath(users)); }}
          footer={<p className="mt-3 text-center text-xs text-muted">Secure payment by Stripe. Review before you pay.</p>}
        />
      )}
    </section>
  );
}
