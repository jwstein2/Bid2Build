/**
 * Writes a demo dataset into a provisioned demo workspace, one numbered step per call to
 * public.demo_apply(). Each step is its own transaction and runs exactly once: the database skips a
 * step that already ran (a retried request) and refuses one out of order. Seeding is resumable: a
 * request does as many steps as fit in its time budget and the next request continues, so a large
 * dataset never runs into a serverless function timeout. The first failure marks the workspace
 * 'failed'; Reset then starts over with a fresh demo login.
 *
 * `rpc` is injected so the server (Supabase service client) and the database tests (pg) share this code.
 */
import type { DemoDataset } from "./dataset";

export type DemoRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

const chunk = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

export function demoSteps(d: DemoDataset): { kind: string; rows: unknown }[] {
  return [
    { kind: "base", rows: d.business },
    ...chunk(d.resources, 50).map((rows) => ({ kind: "resources", rows })),
    ...chunk(d.customers, 150).map((rows) => ({ kind: "customers", rows })),
    ...chunk(d.estimates.map(({ id, createdAt, payload, version, stages }) => ({ id, createdAt, payload, version, stages })), 20).map((rows) => ({ kind: "estimates", rows })),
    ...chunk(d.schedules, 15).map((rows) => ({ kind: "schedules", rows })),
    ...chunk(d.invoices, 33).map((rows) => ({ kind: "invoices", rows })),
    ...(d.changeOrders.length ? [{ kind: "changes", rows: d.changeOrders }] : []),
    ...chunk(d.comms, 200).map((rows) => ({ kind: "comms", rows })),
    // Simulated bank: the feed (one statement per month), then posting in chunks, then reconciliations + cash plan.
    { kind: "bank", rows: { ...d.bank, reconcile: undefined, statements: d.bank.statements.map((s) => ({ ...s, transactions: s.transactions.map((t) => ({ txnRef: t.txnRef, date: t.date, description: t.description, amount: t.amount, checkNumber: t.checkNumber })) })) } },
    ...chunk(d.bank.statements.flatMap((s) => s.transactions).filter((t) => t.post).map((t) => ({ txnRef: t.txnRef, post: t.post })), 150).map((rows) => ({ kind: "bank_post", rows })),
    { kind: "bank_finish", rows: { reconcile: d.bank.reconcile, cashPlan: d.cashPlan } },
    { kind: "finish", rows: {} },
  ];
}

export interface ApplyResult { done: boolean; nextStep: number; total: number; error?: string; step?: string }

export async function applyDemoDataset(rpc: DemoRpc, workspaceId: string, d: DemoDataset, opts: { fromStep?: number; budgetMs?: number; now?: () => number } = {}): Promise<ApplyResult> {
  const steps = demoSteps(d);
  const now = opts.now ?? Date.now;
  const started = now();
  let i = opts.fromStep ?? 0;
  for (; i < steps.length; i++) {
    if (opts.budgetMs !== undefined && i > (opts.fromStep ?? 0) && now() - started > opts.budgetMs) return { done: false, nextStep: i, total: steps.length };
    const s = steps[i];
    try {
      await rpc("demo_apply", { p_workspace: workspaceId, p_kind: s.kind, p_rows: s.rows, p_seed_version: d.seedVersion, p_step: i });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      await rpc("demo_mark_failed", { p_workspace: workspaceId, p_error: `${s.kind}: ${msg}` }).catch(() => {});
      return { done: false, nextStep: i, total: steps.length, error: msg, step: s.kind };
    }
  }
  return { done: true, nextStep: steps.length, total: steps.length };
}
