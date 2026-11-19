"use client";
import { useState } from "react";
import { draftScript } from "@/app/sales/(portal)/academy-actions";

/** Draft an editable starter script for this lead (Haiku). Always a starting point, never word for word. */
export function StarterScript({ leadId, disabled }: { leadId: string; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "cold_call" | "intro">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const go = async (kind: "cold_call" | "intro") => {
    setBusy(kind); setMsg(null);
    const r = await draftScript(leadId, kind);
    setBusy(null);
    if (r.ok) { setText(r.text); setMsg(`${r.remaining} AI drafts left this month.`); } else setMsg(r.message);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select manually */ } };
  return (
    <div>
      <p className="text-sm text-ink-soft">A starting point built from this lead&apos;s brief and our Academy playbook. Make it yours before you call.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !!busy} onClick={() => go("cold_call")} className="min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{busy === "cold_call" ? "Drafting…" : "Cold call script"}</button>
        <button type="button" disabled={disabled || !!busy} onClick={() => go("intro")} className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold disabled:opacity-50">{busy === "intro" ? "Drafting…" : "Intro / follow-up script"}</button>
      </div>
      {text && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent-ink">Starting point: edit before using</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} aria-label="Starter script" className="w-full rounded-lg border border-line bg-white p-3 text-sm" />
          <button type="button" onClick={copy} className="mt-2 min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold">{copied ? "Copied" : "Copy"}</button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-muted" aria-live="polite">{msg}</p>}
    </div>
  );
}
