"use client";
import { Check, ChevronDown, Info, Minus, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, ButtonLink } from "../ui/button";
import { AuthDialog } from "../auth/auth-dialog";
import { codeRequestedText, emailOtpLength } from "@/lib/auth/config";
import { ENTERPRISE_INCLUDED_USERS, formatCents } from "@/lib/enterprise/pricing";
import { TEAM_MIN_EDITORS, clampEditors, teamEstimate } from "@/lib/enterprise/team-estimate";
import { PM_EDITOR_CENTS } from "@/lib/pm/billing";

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
export const enterpriseReturnPath = (users: number, editors = TEAM_MIN_EDITORS) =>
  `/pricing?plan=enterprise&users=${clampUsers(users)}${editors > TEAM_MIN_EDITORS ? `&editors=${clampEditors(editors, clampUsers(users))}` : ""}#enterprise`;

/** "Get Team" buttons elsewhere on the page fire this to start Team checkout in one click. */
export const GET_TEAM_EVENT = "b2b:get-team";

/**
 * The Team choice, kept in this browser for an hour while the visitor verifies their email, so a
 * refresh, a closed tab or an email-link sign-in still lands back on Team checkout.
 */
const TEAM_INTENT_KEY = "b2b.checkoutTeam";
const TEAM_INTENT_TTL_MS = 60 * 60_000;
export function parseTeamIntent(raw: string | null, now = Date.now()): { users: number; editors: number } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { users?: unknown; editors?: unknown; at?: unknown };
    if (typeof v.at !== "number" || now - v.at > TEAM_INTENT_TTL_MS || v.at > now + 60_000) return null;
    const users = clampUsers(Number(v.users));
    return { users, editors: clampEditors(Number(v.editors ?? TEAM_MIN_EDITORS), users) };
  } catch { return null; }
}
function saveTeamIntent(users: number, editors: number) { try { window.localStorage.setItem(TEAM_INTENT_KEY, JSON.stringify({ users, editors, at: Date.now() })); } catch { /* storage blocked: the return URL still carries it */ } }
function readTeamIntent() { try { return parseTeamIntent(window.localStorage.getItem(TEAM_INTENT_KEY)); } catch { return null; } }
function clearTeamIntent() { try { window.localStorage.removeItem(TEAM_INTENT_KEY); } catch { /* ignore */ } }

/** What the signed-in visitor already has, so Team never asks them to buy something by mistake. */
export interface ExistingAccess { kind: "paid" | "complimentary"; label: string }

/**
 * Enterprise card: live seat estimate (same pricing module the server bills with) and checkout.
 * `mode` decides the action: open = checkout is live; contact = prices not configured yet;
 * member = already in a company; owner = already the owner (manage instead).
 */
export function EnterprisePlan({ signedIn, mode, supportEmail, extraFeatures = [], existing = null, scheduling = null }: { signedIn: boolean; mode: "open" | "contact" | "member" | "owner"; supportEmail: string; extraFeatures?: string[]; existing?: ExistingAccess | null; /** Project Command Center is marketed live: show the schedule editor counter. */ scheduling?: { productName: string; /** Extra editors can be bought in Team checkout (editor billing is on). */ checkout: boolean } | null }) {
  const params = useSearchParams();
  // The seat estimate survives sign-in (and a refresh) through the return URL.
  const [users, setUsers] = useState(() => clampUsers(Number(params.get("users") ?? ENTERPRISE_INCLUDED_USERS)));
  const [company, setCompany] = useState("");
  const asked = params.get("plan") === "enterprise" || params.get("plan") === "team";
  // A paid Unlimited subscription has to end before Team starts (the server refuses a second one).
  const blocked = existing?.kind === "paid";
  const resumed = asked && signedIn && mode === "open" && !blocked;
  const [open, setOpen] = useState(resumed);
  // Signed-out visitor sent straight to Team (a "Get Team" link or an expired session): verify first.
  const [authOpen, setAuthOpen] = useState(() => asked && !signedIn && mode === "open" && params.get("checkout") !== "cancelled");
  const [resumedFromStorage, setResumedFromStorage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const companyInput = useRef<HTMLInputElement>(null);
  const [editorsWanted, setEditors] = useState(() => clampEditors(Number(params.get("editors") ?? TEAM_MIN_EDITORS), clampUsers(Number(params.get("users") ?? ENTERPRISE_INCLUDED_USERS))));
  // Fewer users than editors: the editor count follows the user count down.
  const editors = clampEditors(editorsWanted, users);
  const est = teamEstimate(users, editors, { includeEditors: Boolean(scheduling) });
  // Editors carried into checkout only when checkout can bill them; otherwise they're added after.
  const editorsAtCheckout = Boolean(scheduling?.checkout);
  const dueCents = editorsAtCheckout ? est.totalCents : est.checkoutCents;

  // Back from verification: bring the Enterprise card into view with the company step ready.
  useEffect(() => {
    if (!resumed) return;
    document.getElementById("enterprise")?.scrollIntoView({ block: "start" });
    companyInput.current?.focus({ preventScroll: true });
  }, [resumed]);

  // Verified somewhere that didn't come back here (another tab, an email link, a refresh): the Team
  // choice saved in this browser brings them back to the company step instead of starting over.
  useEffect(() => {
    if (resumed || !signedIn || mode !== "open" || blocked) return;
    const saved = readTeamIntent();
    if (!saved) return;
    /* eslint-disable react-hooks/set-state-in-effect -- browser storage is only readable after hydration */
    setUsers(saved.users); setEditors(saved.editors); setOpen(true); setResumedFromStorage(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    document.getElementById("enterprise")?.scrollIntoView({ block: "start" });
    companyInput.current?.focus({ preventScroll: true });
  }, [resumed, signedIn, mode, blocked]);
  useEffect(() => { if (mode === "owner" || mode === "member" || blocked) clearTeamIntent(); }, [mode, blocked]);

  // "Get Team" on the plan cards: one click to verification (or the company step when signed in).
  const startRef = useRef<() => void>(() => {});
  useEffect(() => {
    const go = () => { document.getElementById("enterprise")?.scrollIntoView({ block: "start", behavior: "smooth" }); startRef.current(); };
    window.addEventListener(GET_TEAM_EVENT, go);
    return () => window.removeEventListener(GET_TEAM_EVENT, go);
  }, []);

  async function start() {
    if (mode !== "open" || blocked) return;
    if (!signedIn) { saveTeamIntent(users, editors); setAuthOpen(true); return; }
    if (!open) { setOpen(true); setTimeout(() => companyInput.current?.focus(), 0); return; }
    if (!company.trim()) { setErr("Enter your company name."); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/stripe/enterprise-checkout", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName: company.trim(), users, ...(editorsAtCheckout ? { editors } : {}), attempt: crypto.randomUUID() }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (r?.ok && d?.url) { clearTeamIntent(); window.location.assign(d.url); return; }
    setBusy(false);
    if (d?.error?.code === "not_authenticated") setAuthOpen(true);
    else setErr(d?.error?.message ?? "We couldn't start checkout. Please try again.");
  }

  const clamp = clampUsers;
  useEffect(() => { startRef.current = () => { void start(); }; });

  return (
    <section id="enterprise" aria-labelledby={`${id}-h`} className="mx-auto mt-10 max-w-5xl rounded-2xl border border-navy/20 bg-surface p-4 shadow-sm sm:p-6 md:p-8" data-testid="enterprise-plan">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wide text-accent-ink">For contracting teams</p>
          <h2 id={`${id}-h`} className="mt-1 font-display text-2xl font-extrabold">Team</h2>
          <p className="mt-3 whitespace-nowrap"><span className="font-display text-4xl font-extrabold">$49.99</span><span className="font-semibold text-muted">/month</span></p>
          <p className="mt-1 text-sm font-semibold text-ink">Built for growing contracting teams.</p>
          <p className="mt-2 text-sm text-ink-soft">Includes your primary administrator account plus two additional team members at no extra charge. All three accounts include full access to unlimited bidding.</p>
          <p className="mt-2 text-sm text-ink-soft">Manage your team&apos;s estimates, customers, pipeline, and performance from one powerful company dashboard.</p>
          <ul className="mt-5 space-y-2 text-sm">{[...ENTERPRISE_FEATURES, ...extraFeatures].map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{f}</li>)}</ul>
        </div>
        <div className="min-w-0 rounded-xl bg-paper p-4 sm:p-5" data-testid="team-builder">
          <h3 className="font-display text-xl font-extrabold">Build Your Team</h3>
          <p className="mt-1 text-sm text-ink-soft">Start with {ENTERPRISE_INCLUDED_USERS} included team members. Add users as you grow{scheduling ? ", and choose who can manage project schedules" : ""}.</p>

          {/* 1. Licensed users: accounts. */}
          <section aria-labelledby={`${id}-users-h`} className="mt-4" data-testid="team-users-section">
            <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">User access</p>
            <div className="flex flex-wrap items-center gap-x-1">
              <h4 id={`${id}-users-h`} className="font-display font-bold max-[359px]:text-[0.95rem]">Licensed team members</h4>
              <InfoToggle id={`${id}-users-info`} label="What is a licensed user?">A named team member with their own login and role-based access to Built2Bid.</InfoToggle>
            </div>
            <table className="mt-1 w-full text-sm tabular-nums">
              <caption className="sr-only">Team price per licensed user</caption>
              <tbody>
                <tr className="border-b border-line"><td className="py-1.5 pr-2">Users 1–3</td><td className="whitespace-nowrap py-1.5 text-right font-semibold">Included in $49.99</td></tr>
                <tr className="border-b border-line"><td className="py-1.5 pr-2">Users 4–5</td><td className="whitespace-nowrap py-1.5 text-right font-semibold">$19.99<span className="font-normal text-ink-soft"> each</span></td></tr>
                <tr className="border-b border-line"><td className="py-1.5 pr-2">Users 6–10 <span className="text-ink-soft">(10% off)</span></td><td className="whitespace-nowrap py-1.5 text-right font-semibold">$17.99<span className="font-normal text-ink-soft"> each</span></td></tr>
                <tr><td className="py-1.5 pr-2">Users 11+ <span className="text-ink-soft">(20% off)</span></td><td className="whitespace-nowrap py-1.5 text-right font-semibold">$15.99<span className="font-normal text-ink-soft"> each</span></td></tr>
              </tbody>
            </table>
            <p className="mt-1.5 text-xs text-ink-soft">Per user, per month. Every licensed user gets their own account and login. Each discount applies only to the users inside its tier, not to earlier users.</p>
            <Stepper id={`${id}-users`} label="Licensed users" unit="users" value={users} min={ENTERPRISE_INCLUDED_USERS} max={MAX_ESTIMATE}
              lessLabel="Fewer users" moreLabel="More users" onChange={(n) => setUsers(clamp(n))} />
          </section>

          {/* 2. Schedule editors: a permission on existing users, never an account. */}
          {scheduling && (
            <section aria-labelledby={`${id}-ed-h`} className="mt-4 border-t border-dashed border-line pt-4" data-testid="team-editors-section">
              <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">Project scheduling access · optional</p>
              <div className="flex flex-wrap items-center gap-x-1">
                <h4 id={`${id}-ed-h`} className="font-display font-bold">Schedule editors</h4>
                <InfoToggle id={`${id}-ed-info`} label="What is a schedule editor?">A licensed team member authorized to create and modify schedules in {scheduling.productName}. One editor is included.</InfoToggle>
              </div>
              <p className="mt-1 text-sm text-ink-soft">Your Team plan includes <b className="text-ink">1 schedule editor</b>. Need more people managing project schedules? Give scheduling permission to existing licensed users for <b className="text-ink">{formatCents(PM_EDITOR_CENTS)}/editor/month</b> each. No additional account is created, and it doesn&apos;t replace a user license.</p>
              <Stepper id={`${id}-editors`} label="Schedule editors" unit={editors === 1 ? "editor" : "editors"} value={editors} min={TEAM_MIN_EDITORS} max={users}
                lessLabel="Fewer schedule editors" moreLabel="More schedule editors" onChange={(n) => setEditors(clampEditors(n, users))}
                hint={editors >= users ? "Up to one per licensed user." : undefined} />
            </section>
          )}

          {/* Live breakdown, total first in weight. */}
          <dl className="mt-4 space-y-1 rounded-lg border border-line bg-surface p-3 text-sm tabular-nums" data-testid="enterprise-quote">
            <Row label={`Team subscription (${ENTERPRISE_INCLUDED_USERS} users)`} value={formatCents(est.baseCents)} />
            <Row testId="team-line-users" label={est.userLines.length === 1 ? `Additional users (${est.userLines[0].users} × ${formatCents(est.userLines[0].unitCents)})` : est.extraUsers > 0 ? `Additional users (${est.extraUsers})` : "Additional users"} value={formatCents(est.extraUsersCents)} />
            {est.userLines.length > 1 && est.userLines.map((l) => <Row key={l.label} sub label={`${l.label}: ${l.users} × ${formatCents(l.unitCents)}`} value={formatCents(l.totalCents)} />)}
            {scheduling && <Row testId="team-line-editors" label={est.extraEditors > 0 ? `Extra schedule editors (${est.extraEditors} × ${formatCents(PM_EDITOR_CENTS)})` : "Schedule editors (1 included)"} value={formatCents(est.extraEditorsCents)} />}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line pt-2">
              <dt className="font-bold leading-tight">Estimated monthly total</dt>
              <dd className="ml-auto shrink-0 whitespace-nowrap text-right font-display text-lg font-extrabold min-[360px]:text-xl" data-testid="enterprise-total">{formatCents(est.totalCents)}<span className="text-sm font-semibold text-muted">/month</span></dd>
            </div>
          </dl>
          {scheduling && !editorsAtCheckout && est.extraEditors > 0 && (
            <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft" role="note" data-testid="team-editors-after-checkout">
              Checkout covers your Team subscription and licensed users ({formatCents(est.checkoutCents)}/month). Add the {est.extraEditors} extra schedule editor{est.extraEditors === 1 ? "" : "s"} (+{formatCents(est.extraEditorsCents)}/month) after checkout from Team billing, when you assign them.
            </p>
          )}
          {scheduling && editorsAtCheckout && est.extraEditors > 0 && (
            <p className="mt-2 text-xs text-ink-soft" data-testid="team-editors-in-checkout">Your {editors} schedule editors are added to checkout. You choose which licensed users get scheduling access after you sign up.</p>
          )}
          {scheduling && (
            <details className="group mt-2 text-xs text-ink-soft">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 font-semibold text-accent-ink [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />Do I need to purchase both?
              </summary>
              <p className="pb-1">Additional team members require a user license. The scheduling add-on is only needed when more than one licensed team member needs schedule-editing permissions.</p>
            </details>
          )}

          {mode === "open" && open && (
            <div className="mt-4">
              <label htmlFor={`${id}-co`} className="text-sm font-semibold">Company name</label>
              {(resumed || resumedFromStorage) && <p className="mt-1 text-xs text-ok" role="status">You&apos;re signed in. Add your company name to review checkout.</p>}
              <input ref={companyInput} id={`${id}-co`} value={company} maxLength={200} autoComplete="organization" onChange={(e) => setCompany(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" />
            </div>
          )}
          {existing && mode === "open" && (
            <div className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm" role="status" data-testid="team-existing-access">
              {existing.kind === "paid" ? (
                <>
                  <p className="font-semibold">You&apos;re on {existing.label}.</p>
                  <p className="mt-1 text-ink-soft">Team replaces Individual Unlimited, so you won&apos;t be asked to pay for both. Turn off Individual Unlimited&apos;s renewal in <a href="/settings/billing" className="font-semibold text-accent-ink underline">Subscription settings</a> (it stays active until the end of your paid period), then start Team here. Questions? <a href={`mailto:${supportEmail}?subject=${encodeURIComponent("Switching to Built2Bid Team")}`} className="font-semibold text-accent-ink underline">Email us</a>.</p>
                </>
              ) : (
                <p><span className="font-semibold">You have {existing.label}.</span> <span className="text-ink-soft">It stays as it is. Team adds a company account with licensed users for your crew.</span></p>
              )}
            </div>
          )}
          <div className="mt-5">
            {mode === "owner" ? <>{asked && <p className="mb-2 text-sm font-semibold text-ok" role="status" data-testid="team-already-owner">You already have Team. Manage users, seats and billing here.</p>}<ButtonLink href="/company/billing" variant="secondary" size="lg" className="w-full">Manage Team</ButtonLink></>
              : mode === "member" ? <p className="text-sm text-ink-soft" role={asked ? "status" : undefined}>You&apos;re already on your company&apos;s Team plan. Ask your company owner about seats.</p>
              : blocked ? <ButtonLink href="/settings/billing" variant="secondary" size="lg" className="w-full" data-cta="team-manage-unlimited">Manage your Individual Unlimited subscription</ButtonLink>
              : mode === "contact" ? <ButtonLink href={`mailto:${supportEmail}?subject=${encodeURIComponent("Built2Bid Team")}`} size="lg" className="w-full">Contact us about Team</ButtonLink>
              : <Button loading={busy} size="lg" className="h-auto min-h-12 w-full whitespace-normal py-3" onClick={start} disabled={busy}>{open ? `Continue to checkout · ${formatCents(dueCents)}/month` : "Get Team"}</Button>}
            {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
            <p className="mt-2 text-xs text-ink-soft">Billed monthly, no long-term contract. Added users are prorated; removed users lower your price from the next invoice, with no refund for the current month. Prices in USD; taxes may apply.</p>
          </div>
        </div>
      </div>
      {authOpen && (
        <AuthDialog
          open
          onOpenChange={setAuthOpen}
          next={enterpriseReturnPath(users, editors)}
          copy={{
            title: "Verify your email to continue with Team",
            emailDescription: "No password needed. Your Team selection and team size stay selected. Nothing is charged until you review checkout.",
            sentDescription: (email) => `${codeRequestedText(email, emailOtpLength())} Enter it to continue with Team.`,
            phoneDescription: "Verify your mobile number to continue with Team. Your team size stays selected.",
            phoneSentDescription: (phone) => `We texted a 6-digit code to ${phone}. Enter it here to continue with Team.`,
            submitLabel: "Verify and continue",
          }}
          summary={
            <div className="mb-4 rounded-xl border border-line bg-paper p-3" aria-label="Your plan" data-testid="enterprise-auth-summary">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">Your plan</p>
                  <p className="mt-0.5 font-display text-lg font-extrabold leading-tight">Team</p>
                </div>
                <p className="shrink-0 text-right"><span className="font-display text-xl font-extrabold">{formatCents(dueCents)}</span><span className="text-sm font-semibold text-muted">/month</span></p>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{users} licensed users ({ENTERPRISE_INCLUDED_USERS} included){editorsAtCheckout && editors > TEAM_MIN_EDITORS ? `, ${editors} schedule editors (1 included)` : ""}. Billed monthly; you review the total before paying.</p>
            </div>
          }
          // Full navigation so the server re-checks the account (it may already own or belong to a company).
          onVerified={() => { window.location.assign(enterpriseReturnPath(users, editors)); }}
          footer={<p className="mt-3 text-center text-xs text-muted">Secure payment by Stripe. Review before you pay.</p>}
        />
      )}
    </section>
  );
}

function Row({ label, value, sub = false, testId }: { label: string; value: string; sub?: boolean; testId?: string }) {
  return (
    <div className={`flex justify-between gap-3 ${sub ? "pl-3 text-xs text-ink-soft" : ""}`} data-testid={testId}>
      <dt className={sub ? "" : "text-ink-soft"}>{label}</dt><dd className="shrink-0 text-right">{value}</dd>
    </div>
  );
}

/** Plus/minus counter with a typed value. Buttons are 44px for thumbs. */
function Stepper({ id, label, unit, value, min, max, lessLabel, moreLabel, onChange, hint }: {
  id: string; label: string; unit: string; value: number; min: number; max: number; lessLabel: string; moreLabel: string; onChange: (n: number) => void; hint?: string;
}) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <Button type="button" variant="secondary" className="w-11 shrink-0 px-0" aria-label={lessLabel} aria-controls={id} onClick={() => onChange(value - 1)} disabled={value <= min}><Minus className="h-4 w-4" /></Button>
        <input id={id} type="number" inputMode="numeric" min={min} max={max} value={value}
          onChange={(e) => onChange(Number(e.target.value))} className="h-11 w-16 min-w-0 rounded-lg border border-line bg-surface px-2 text-center text-base font-semibold tabular-nums" />
        <Button type="button" variant="secondary" className="w-11 shrink-0 px-0" aria-label={moreLabel} aria-controls={id} onClick={() => onChange(value + 1)} disabled={value >= max}><Plus className="h-4 w-4" /></Button>
        <span className="text-sm text-ink-soft">{unit}</span>
      </div>
      {hint && <p className="mt-1 text-xs text-ink-soft" role="status">{hint}</p>}
    </div>
  );
}

/** Small "i" that opens a one-line explanation in place. Tap, click or keyboard; no hover needed. */
function InfoToggle({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="-my-1 inline-flex h-9 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-accent">
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {open && <p id={id} role="note" className="basis-full rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft"><b className="text-ink">{label}</b> {children}</p>}
    </>
  );
}
