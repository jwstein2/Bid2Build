"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/misc";
import { Modal } from "@/components/builder/dialogs";
import { COMP_PLAN_LABELS, DURATION_PRESETS, INCLUDED_SEATS, MAX_EXTRA_SEATS, MAX_GRANT_DAYS, type CompPlan } from "@/lib/comp/grants";
import { createGrant, type ActionResult } from "./actions";
import { CopyLink } from "./copy-link";

const input = "w-full rounded-md border border-line-strong px-3 py-2 min-h-11";

export function GrantForm() {
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<CompPlan>("unlimited");
  const [preset, setPreset] = useState<string>("30");
  const [custom, setCustom] = useState("45");
  const [extraSeats, setExtraSeats] = useState(0);
  const [approveSeats, setApproveSeats] = useState(false);
  const [sendInvite, setSendInvite] = useState(true);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const days = preset === "custom" ? Number(custom) : Number(preset);
  const seats = plan === "enterprise" ? extraSeats : 0;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const daysOk = Number.isInteger(days) && days >= 1 && days <= MAX_GRANT_DAYS;
  const seatsOk = seats === 0 || approveSeats;
  const fieldErrors = result && !result.ok ? result.fieldErrors ?? {} : {};

  function submit() {
    start(async () => {
      const r = await createGrant({ email, plan, days, extraSeats: seats, approveExtraSeats: approveSeats, sendInvite, note: note || undefined });
      setResult(r);
      setConfirming(false);
      if (r.ok) { setEmail(""); setNote(""); setExtraSeats(0); setApproveSeats(false); }
    });
  }

  return (
    <Card className="p-5">
      <h2 className="font-display text-xl font-bold">Grant access</h2>
      <form className="mt-4 grid gap-4 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (emailOk && daysOk && seatsOk) { setResult(null); setConfirming(true); } }}>
        <label className="text-sm font-medium">Email address
          <input type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={`${input} mt-1`} aria-invalid={Boolean(fieldErrors.email)} />
          {fieldErrors.email && <span className="mt-1 block text-xs text-danger">{fieldErrors.email}</span>}
        </label>

        <fieldset className="text-sm">
          <legend className="font-medium">Access level</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {(["unlimited", "enterprise"] as const).map((p) => (
              <label key={p} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-md border px-3 py-2 ${plan === p ? "border-brand bg-brand-tint" : "border-line-strong"}`}>
                <input type="radio" name="plan" value={p} checked={plan === p} onChange={() => setPlan(p)} className="mt-1" />
                <span><span className="font-semibold">{COMP_PLAN_LABELS[p]}</span><span className="block text-xs text-ink-soft">{p === "unlimited" ? "Unlimited bids, Saved Items, Proposal Templates." : `Company admin + ${INCLUDED_SEATS.enterprise - 1} team members (${INCLUDED_SEATS.enterprise} licensed users).`}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="text-sm">
          <legend className="font-medium">Duration</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {[...DURATION_PRESETS.map(String), "custom"].map((d) => (
              <label key={d} className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 ${preset === d ? "border-brand bg-brand-tint font-semibold" : "border-line-strong"}`}>
                <input type="radio" name="duration" value={d} checked={preset === d} onChange={() => setPreset(d)} className="sr-only" />
                {d === "custom" ? "Custom" : `${d} days`}
              </label>
            ))}
          </div>
          {preset === "custom" && (
            <label className="mt-2 flex items-center gap-2">
              <input type="number" min={1} max={MAX_GRANT_DAYS} inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} className={`${input} w-28`} aria-label="Custom number of days" />
              <span className="text-ink-soft">days (1–{MAX_GRANT_DAYS})</span>
            </label>
          )}
          {!daysOk && <span className="mt-1 block text-xs text-danger">Choose between 1 and {MAX_GRANT_DAYS} days.</span>}
          <span className="mt-1 block text-xs text-muted">New recipients: the clock starts when they accept. Existing accounts: starts now.</span>
        </fieldset>

        {plan === "enterprise" ? (
          <div className="text-sm">
            <label className="font-medium">Additional complimentary seats
              <input type="number" min={0} max={MAX_EXTRA_SEATS} inputMode="numeric" value={extraSeats} onChange={(e) => { setExtraSeats(Math.max(0, Math.min(MAX_EXTRA_SEATS, Number(e.target.value) || 0))); setApproveSeats(false); }} className={`${input} mt-1 w-28`} />
            </label>
            <p className="mt-1 text-xs text-muted">{INCLUDED_SEATS.enterprise} licensed users are included. The recipient can never add free seats themselves.</p>
            {extraSeats > 0 && (
              <label className="mt-2 flex items-start gap-2 rounded-md border border-warn/40 bg-warn-tint px-3 py-2">
                <input type="checkbox" checked={approveSeats} onChange={(e) => setApproveSeats(e.target.checked)} className="mt-1" />
                <span>As the Built2Bid platform owner, I authorize {extraSeats} extra free seat{extraSeats === 1 ? "" : "s"} ({INCLUDED_SEATS.enterprise + extraSeats} licensed users in total).</span>
              </label>
            )}
          </div>
        ) : <div className="hidden lg:block" />}

        <label className="text-sm font-medium lg:col-span-1">Internal note <span className="font-normal text-muted">(optional, admins only)</span>
          <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Demo for ABC Roofing, met at trade show" className={`${input} mt-1`} />
        </label>

        <label className="flex items-start gap-2 self-end text-sm">
          <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} className="mt-1" />
          <span><span className="font-medium">Send invitation email</span><span className="block text-xs text-muted">Only sent if they don&apos;t have a verified account yet. It has a sign-up link that activates the grant. Links expire after 30 days.</span></span>
        </label>

        <div className="lg:col-span-2">
          <Button type="submit" disabled={!emailOk || !daysOk || !seatsOk || pending}>Grant access…</Button>
        </div>
      </form>

      {result && (result.ok ? (
        <div className="mt-4 space-y-2">
          <Notice tone="ok" title="Done">{result.message}</Notice>
          {result.warning && <Notice tone="warn" title="Invitation not sent">{result.warning}</Notice>}
          {result.inviteLink && <CopyLink link={result.inviteLink} />}
        </div>
      ) : <Notice tone="danger" title="Not granted" className="mt-4">{result.error}</Notice>)}

      <Modal open={confirming} onOpenChange={setConfirming} title="Grant complimentary access?" description="No payment is taken and Stripe is not touched.">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-ink-soft">Email</dt><dd className="break-all font-semibold">{email.trim().toLowerCase()}</dd>
          <dt className="text-ink-soft">Access</dt><dd className="font-semibold">{COMP_PLAN_LABELS[plan]}</dd>
          <dt className="text-ink-soft">Duration</dt><dd className="font-semibold">{days} days</dd>
          {plan === "enterprise" && <><dt className="text-ink-soft">Licensed users</dt><dd className="font-semibold">{INCLUDED_SEATS.enterprise + seats}{seats > 0 && ` (${seats} extra authorized)`}</dd></>}
          <dt className="text-ink-soft">Invitation</dt><dd>{sendInvite ? "Email it if they have no verified account" : "Don't email (link shown after)"}</dd>
        </dl>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{pending ? "Granting…" : "Grant access"}</Button>
        </div>
      </Modal>
    </Card>
  );
}
