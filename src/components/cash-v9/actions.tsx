"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { tbAction } from "@/components/tax-banking/client";
import { serializeWhatIf, WHATIF_LABELS, type WhatIf } from "@/lib/cash-v9/whatif";

/** POST one V9 action. The server re-checks every permission. */
export function useV9() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const run = async (payload: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    const r = await tbAction(payload, "/api/financials/cash-v9");
    setBusy(false);
    if (!r.ok) { setMsg({ tone: "danger", text: r.message }); return false; }
    setMsg({ tone: "ok", text: ok });
    router.refresh();
    return true;
  };
  return { busy, msg, run };
}

export function Msg({ msg }: { msg: { tone: "ok" | "danger"; text: string } | null }) {
  if (!msg) return null;
  return <p role="status" className={`text-sm ${msg.tone === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</p>;
}

const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** Acknowledge / snooze / resolve. Never changes a financial record. */
export function AlertActions({ id, status, canAct }: { id: string; status: string; canAct: boolean }) {
  const { busy, msg, run } = useV9();
  if (!canAct) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "acknowledged" && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => run({ action: "alert_set", alertId: id, p: { status: "acknowledged" } }, "Marked as seen.")}>Got it</Button>}
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => run({ action: "alert_set", alertId: id, p: { status: "snoozed", snoozeUntil: inDays(7) } }, "Snoozed for a week.")}>Snooze 7 days</Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => run({ action: "alert_set", alertId: id, p: { status: "resolved" } }, "Resolved.")}>Resolve</Button>
      <Msg msg={msg} />
    </div>
  );
}

/** Build a what-if in the URL (nothing is saved). */
export function WhatIfForm({ current, jobs, baseHref }: { current: WhatIf[]; jobs: { id: string; name: string }[]; baseHref: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<WhatIf["kind"]>("late");
  const [a, setA] = useState("15");
  const [job, setJob] = useState(jobs[0]?.id ?? "");
  const [date, setDate] = useState(inDays(14));
  const [b, setB] = useState("40");
  const go = (list: WhatIf[]) => {
    const u = new URL(baseHref, window.location.origin);
    if (list.length) u.searchParams.set("wi", serializeWhatIf(list)); else u.searchParams.delete("wi");
    router.push(`${u.pathname}?${u.searchParams.toString()}#whatif`);
  };
  const build = (): WhatIf | null => {
    const n = Number(a);
    if (!Number.isFinite(n) || n <= 0) return null;
    switch (kind) {
      case "late": return { kind, days: n, jobId: job || null };
      case "delay": return job ? { kind, days: n, jobId: job } : null;
      case "cost": return { kind, pct: n, jobId: job || null };
      case "deposit": return { kind, amount: n, date };
      case "expense": return { kind, amount: n, date };
      case "hire": return { kind, hourlyCost: n, hoursPerWeek: Number(b) || 40, start: date };
      case "remove_job": return job ? { kind, jobId: job } : null;
      case "add_job": return { kind, amount: n, start: date, weeks: Number(b) || 4, costPct: 70, payDays: 7 };
    }
  };
  const needsJob = ["late", "delay", "cost", "remove_job"].includes(kind);
  const label = kind === "late" || kind === "delay" ? "Days" : kind === "cost" ? "Percent more" : kind === "hire" ? "Hourly cost ($)" : kind === "remove_job" ? "" : "Amount ($)";
  return (
    <form className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="v9-whatif-form"
      onSubmit={(e) => { e.preventDefault(); const w = build(); if (w) go([...current, w].slice(0, 8)); }}>
      <label className="label" htmlFor="wi-kind">What if…<select id="wi-kind" className="field mt-1" value={kind} onChange={(e) => setKind(e.target.value as WhatIf["kind"])}>
        {Object.entries(WHATIF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {label && <label className="label" htmlFor="wi-a">{label}<input id="wi-a" inputMode="decimal" className="field mt-1" value={a} onChange={(e) => setA(e.target.value.replace(/[^0-9.]/g, ""))} /></label>}
      {needsJob && <label className="label" htmlFor="wi-job">Job<select id="wi-job" className="field mt-1" value={job} onChange={(e) => setJob(e.target.value)}>
        {kind === "late" || kind === "cost" ? <option value="">All jobs</option> : null}{jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>}
      {["deposit", "expense", "hire", "add_job"].includes(kind) && <label className="label" htmlFor="wi-date">{kind === "hire" || kind === "add_job" ? "Starts" : "Date"}<input id="wi-date" type="date" className="field mt-1" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
      {(kind === "hire" || kind === "add_job") && <label className="label" htmlFor="wi-b">{kind === "hire" ? "Hours per week" : "Weeks of work"}<input id="wi-b" inputMode="numeric" className="field mt-1" value={b} onChange={(e) => setB(e.target.value.replace(/[^0-9]/g, ""))} /></label>}
      <div className="flex items-end gap-2"><Button type="submit">Try it</Button>{current.length > 0 && <Button type="button" variant="secondary" onClick={() => go([])}>Clear</Button>}</div>
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-5">What-ifs only change this view. Nothing is saved, sent or changed in your records.{kind === "add_job" ? " A new job assumes costs of 70% of its price and payment 7 days after it finishes." : ""}</p>
    </form>
  );
}
