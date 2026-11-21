/**
 * What-if scenarios (pure). Adjustments apply to a copy of the forecast's flows only: no record is changed, saved or
 * sent. Approved bills you already owe stay in every scenario (cancelling a job doesn't cancel a bill).
 */
import { addDays, isDay, shortDate } from "./dates";
import type { ExtraFlowV9 } from "./types";

export type WhatIf =
  | { kind: "late"; days: number; jobId?: string | null }
  | { kind: "delay"; days: number; jobId: string }
  | { kind: "cost"; pct: number; jobId?: string | null }
  | { kind: "deposit"; amount: number; date: string; label?: string }
  | { kind: "hire"; hourlyCost: number; hoursPerWeek: number; start: string }
  | { kind: "remove_job"; jobId: string }
  | { kind: "add_job"; amount: number; start: string; weeks: number; costPct: number; payDays: number }
  | { kind: "expense"; amount: number; date: string; label?: string };

export const WHATIF_LABELS: Record<WhatIf["kind"], string> = {
  late: "Customers pay later", delay: "A job takes longer", cost: "Costs go up", deposit: "Supplier wants a deposit", hire: "Hire someone",
  remove_job: "Lose a job", add_job: "Win a new job", expense: "Unexpected expense (e.g. equipment repair)",
};

const n = (v: unknown, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null; };

/** Parse adjustments from the URL (?wi=late:15,delay:14:<job>...). Invalid entries are ignored. At most 8. */
export function parseWhatIf(raw: string | string[] | undefined): WhatIf[] {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((r) => r.split(",")).slice(0, 8);
  const out: WhatIf[] = [];
  const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  for (const p of parts) {
    const [k, a, b, c, d, e] = p.split(":");
    if (k === "late" && n(a, 1, 180) !== null) out.push({ kind: "late", days: n(a, 1, 180)!, jobId: uuid(b) });
    else if (k === "delay" && n(a, 1, 365) !== null && uuid(b)) out.push({ kind: "delay", days: n(a, 1, 365)!, jobId: uuid(b)! });
    else if (k === "cost" && n(a, 1, 200) !== null) out.push({ kind: "cost", pct: n(a, 1, 200)!, jobId: uuid(b) });
    else if (k === "deposit" && n(a, 1, 1e8) !== null && isDay(b)) out.push({ kind: "deposit", amount: n(a, 1, 1e8)!, date: b });
    else if (k === "hire" && n(a, 1, 500) !== null && n(b, 1, 80) !== null && isDay(c)) out.push({ kind: "hire", hourlyCost: n(a, 1, 500)!, hoursPerWeek: n(b, 1, 80)!, start: c });
    else if (k === "remove_job" && uuid(a)) out.push({ kind: "remove_job", jobId: uuid(a)! });
    else if (k === "add_job" && n(a, 1, 1e8) !== null && isDay(b) && n(c, 1, 104) !== null && n(d, 0, 100) !== null) out.push({ kind: "add_job", amount: n(a, 1, 1e8)!, start: b, weeks: n(c, 1, 104)!, costPct: n(d, 0, 100)!, payDays: n(e ?? 7, 0, 120) ?? 7 });
    else if (k === "expense" && n(a, 1, 1e8) !== null && isDay(b)) out.push({ kind: "expense", amount: n(a, 1, 1e8)!, date: b });
  }
  return out;
}

export function serializeWhatIf(w: WhatIf[]): string {
  return w.map((x) => {
    switch (x.kind) {
      case "late": return `late:${x.days}${x.jobId ? `:${x.jobId}` : ""}`;
      case "delay": return `delay:${x.days}:${x.jobId}`;
      case "cost": return `cost:${x.pct}${x.jobId ? `:${x.jobId}` : ""}`;
      case "deposit": return `deposit:${x.amount}:${x.date}`;
      case "hire": return `hire:${x.hourlyCost}:${x.hoursPerWeek}:${x.start}`;
      case "remove_job": return `remove_job:${x.jobId}`;
      case "add_job": return `add_job:${x.amount}:${x.start}:${x.weeks}:${x.costPct}:${x.payDays}`;
      case "expense": return `expense:${x.amount}:${x.date}`;
    }
  }).join(",");
}

const shift = (f: ExtraFlowV9, days: number, why: string): ExtraFlowV9 => ({ ...f, scheduledOn: null, expectedOn: addDays(f.expectedOn, days), note: `${f.note ?? ""} What-if: ${why}.`.trim() });

export function applyWhatIf(flows: ExtraFlowV9[], adj: WhatIf[], today: string, end: string, payLagDays = 5): ExtraFlowV9[] {
  let out = flows.slice();
  adj.forEach((a, i) => {
    switch (a.kind) {
      case "late":
        out = out.map((f) => (Number(f.amount) > 0 && (f.source === "milestone" || f.source === "collection") && (!a.jobId || f.jobId === a.jobId) ? shift(f, a.days, `paid ${a.days} days later`) : f));
        break;
      case "delay":
        out = out.map((f) => (f.jobId === a.jobId && f.source !== "payroll" ? shift(f, a.days, `job ${a.days} days later`) : f));
        break;
      case "cost":
        out = out.map((f) => (Number(f.amount) < 0 && (f.source === "commitment" || f.source === "estimate") && (!a.jobId || f.jobId === a.jobId)
          ? { ...f, amount: (Number(f.amount) * (1 + a.pct / 100)).toFixed(2), note: `${f.note ?? ""} What-if: +${a.pct}% cost.`.trim() } : f));
        break;
      case "remove_job":
        out = out.filter((f) => f.jobId !== a.jobId || f.source === "collection");   // money already invoiced is still owed to you
        break;
      case "deposit":
        out.push({ key: `wi:${i}`, label: a.label ?? "Supplier deposit (what-if)", amount: (-a.amount).toFixed(2), category: "supplier", scheduledOn: null, expectedOn: a.date, href: null, source: "whatif", note: "What-if only" });
        break;
      case "expense":
        out.push({ key: `wi:${i}`, label: a.label ?? "Unexpected expense (what-if)", amount: (-a.amount).toFixed(2), category: "other", scheduledOn: null, expectedOn: a.date, href: null, source: "whatif", note: "What-if only" });
        break;
      case "hire":
        for (let d = addDays(a.start, 6), k = 0; d <= end && k < 60; d = addDays(d, 7), k++) {
          out.push({ key: `wi:${i}:${k}`, label: `New hire week ending ${shortDate(d)} (what-if)`, amount: (-(a.hourlyCost * a.hoursPerWeek)).toFixed(2), category: "payroll",
            scheduledOn: null, expectedOn: addDays(d, payLagDays), href: null, source: "whatif", note: `${a.hoursPerWeek} h × $${a.hourlyCost}/h, paid ${payLagDays} days after the week` });
        }
        break;
      case "add_job": {
        const finish = addDays(a.start, a.weeks * 7);
        out.push({ key: `wi:${i}:in`, label: "New job payment (what-if)", amount: a.amount.toFixed(2), category: "milestone", scheduledOn: null, expectedOn: addDays(finish, a.payDays), href: null, source: "whatif",
          note: `Paid ${a.payDays} days after it finishes ${shortDate(finish)}` });
        const cost = (a.amount * a.costPct) / 100 / a.weeks;
        for (let k = 0; k < a.weeks; k++) out.push({ key: `wi:${i}:c${k}`, label: "New job costs (what-if)", amount: (-cost).toFixed(2), category: "supplier", scheduledOn: null,
          expectedOn: addDays(a.start, k * 7 + 6), href: null, source: "whatif", note: `${a.costPct}% of the job's price, spread by week` });
        break;
      }
    }
  });
  void today;
  return out;
}
