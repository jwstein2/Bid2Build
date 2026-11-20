"use client";
import { useId, useState } from "react";
import { recommendPlan, type BidsPerMonth, type People } from "@/lib/marketing/plan-helper";

const PLAN_NAME = { free: "Free", unlimited: "Individual Unlimited", enterprise: "Team" } as const;

/** Three questions, one suggestion. Only links to a card on this page; never opens checkout. */
export function PlanHelper({ pccLive, pccName }: { pccLive: boolean; pccName: string }) {
  const [bids, setBids] = useState<BidsPerMonth | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [schedule, setSchedule] = useState<boolean | null>(null);
  const id = useId();
  const done = bids && people && schedule !== null;
  const r = done ? recommendPlan({ bids, people, schedule }, pccLive) : null;
  const q = <T extends string | boolean>(name: string, label: string, value: T | null, set: (v: T) => void, opts: [T, string][]) => (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {opts.map(([v, text]) => (
          <label key={String(v)} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy ${value === v ? "border-navy bg-navy text-white" : "border-line bg-surface text-ink hover:border-navy/50"}`}>
            <input type="radio" name={`${id}-${name}`} className="sr-only" checked={value === v} onChange={() => set(v)} />{text}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <section aria-labelledby={`${id}-h`} className="mx-auto mt-10 max-w-5xl rounded-2xl border border-line bg-paper p-4 sm:p-6" data-testid="plan-helper">
      <h2 id={`${id}-h`} className="font-display text-xl font-extrabold">Not sure which plan fits?</h2>
      <p className="mt-1 text-sm text-ink-soft">Answer three questions for a suggestion. Nothing is charged or saved.</p>
      <div className="mt-4 grid gap-5 md:grid-cols-3">
        {q<BidsPerMonth>("bids", "How many bids do you send a month?", bids, setBids, [["one", "About 1"], ["few", "2 to 4"], ["many", "5 or more"]])}
        {q<People>("people", "Who needs to sign in?", people, setPeople, [["solo", "Just me"], ["team", "2 or more people"]])}
        {q<"yes" | "no">("schedule", "Do you schedule crews or subs?", schedule === null ? null : schedule ? "yes" : "no", (v) => setSchedule(v === "yes"), [["yes", "Yes"], ["no", "No"]])}
      </div>
      <div aria-live="polite" className="mt-5 min-h-6">
        {r && (
          <p className="text-sm" data-testid="plan-helper-result" data-plan={r.plan}>
            <b className="font-semibold">Suggested: {PLAN_NAME[r.plan]}{r.addPcc ? ` + ${pccName}` : ""}.</b> {r.why}{" "}
            <a href={r.anchor} className="font-semibold text-navy underline">See {PLAN_NAME[r.plan]}</a>
          </p>
        )}
      </div>
    </section>
  );
}
