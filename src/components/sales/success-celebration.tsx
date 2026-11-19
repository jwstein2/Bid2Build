"use client";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui/misc";
import { SUCCESS_TEXT } from "@/lib/sales/preferences";
import { markSuccessesSeen } from "@/app/sales/(portal)/success-actions";

export interface Success { id: string; kind: string; occurred_at: string; celebrated: boolean; congratulated: boolean; customer: string }

const SPARKS = [8, 22, 38, 54, 70, 86];

/** Shows new customer wins once, with an optional small animation. Purely visual: the record already exists. */
export function SuccessCelebration({ items, firstName, animate }: { items: Success[]; firstName: string; animate: boolean }) {
  const fresh = items.filter((s) => !s.celebrated);
  const [open, setOpen] = useState(fresh.length > 0);
  const [, start] = useTransition();
  if (!open || fresh.length === 0) return null;
  const top = fresh.find((s) => s.kind === "onboarding_complete") ?? fresh[0];
  const t = SUCCESS_TEXT[top.kind] ?? { title: "Customer win", body: "reached a milestone." };
  const dismiss = () => { setOpen(false); start(() => markSuccessesSeen(fresh.map((s) => s.id))); };
  return (
    <Card className={`relative overflow-hidden border-accent/40 p-5 ${animate ? "win-pop" : ""}`} role="status" aria-live="polite">
      {animate && SPARKS.map((x, i) => <span key={x} aria-hidden="true" className="win-spark" style={{ left: `${x}%`, bottom: 8, animationDelay: `${i * 0.12}s` }} />)}
      <p className="text-sm font-semibold text-accent-dark">{t.title}</p>
      <h2 className="mt-1 text-xl font-extrabold">Nice work, {firstName}. {top.customer} {t.body}</h2>
      {fresh.length > 1 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
          {fresh.filter((s) => s !== top).slice(0, 4).map((s) => <li key={s.id}>{s.customer}: {(SUCCESS_TEXT[s.kind]?.title ?? s.kind).toLowerCase()}</li>)}
        </ul>
      )}
      <p className="mt-2 text-sm text-ink-soft">Thanks for helping a contractor succeed. Wins like this are what keeps a customer around for the anniversaries.</p>
      <button onClick={dismiss} className="mt-3 min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white">Thanks!</button>
    </Card>
  );
}

/** Customer successes history for the overview. */
export function CustomerSuccessCard({ items }: { items: Success[] }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold">Customer successes</h2>
      <p className="text-xs text-muted">Recorded from what customers actually do in Built2Bid: a real estimate, a proposal sent or exported, and the 7-day activation goal.</p>
      {items.length === 0 ? <p className="mt-3 text-sm text-ink-soft">When your customers build their first real estimate, it shows up here.</p> : (
        <ul className="mt-3 divide-y divide-line text-sm">
          {items.slice(0, 8).map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span><span className="font-semibold">{s.customer}</span> · {SUCCESS_TEXT[s.kind]?.title ?? s.kind}</span>
              <span className="text-muted">{new Date(s.occurred_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}{s.congratulated ? " · owner congratulated" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
