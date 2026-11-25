"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/misc";

export function ClaimForm() {
  const [email, setEmail] = useState("");
  const [checkins, setCheckins] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError("");
    const company = String(new FormData(e.currentTarget).get("company") ?? "");
    const r = await fetch("/api/trial/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, checkins, company }) }).catch(() => null);
    if (r?.ok) { setState("sent"); return; }
    const body = (await r?.json().catch(() => null)) as { error?: { message?: string } } | null;
    setError(body?.error?.message ?? "Something went wrong. Please try again.");
    setState("error");
  }

  if (state === "sent") {
    return (
      <Notice tone="ok" className="mt-6" title="Check your inbox">
        If that address can get an invite, it&apos;s on its way. Open the email from Built2Bid and tap &quot;Activate my 7 days&quot;. Don&apos;t see it in a few minutes? Check Spam or Promotions.
      </Notice>
    );
  }
  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      <Field label="Email" htmlFor="trial-email" required>
        <input id="trial-email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base" placeholder="you@company.com" />
      </Field>
      {/* Honeypot for bots: hidden from people and screen readers. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <label className="flex items-start gap-2 text-sm text-ink-soft">
        <input type="checkbox" className="mt-1" checked={checkins} onChange={(e) => setCheckins(e.target.checked)} />
        <span>Also send me two short emails during my trial: a quick walkthrough on day 2 and a reminder before it ends. (Optional)</span>
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button loading={state === "sending"} type="submit" variant="accent" disabled={state === "sending" || !email}>{state === "sending" ? "Sending…" : "Send my invite"}</Button>
      <p className="text-xs text-muted">We&apos;ll only use your email for your Built2Bid account and this invite. See our <a href="/privacy" className="underline">Privacy Policy</a>.</p>
    </form>
  );
}
