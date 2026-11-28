// Growth OS worker core. Runtime-agnostic: the Supabase Edge Function (index.ts, Deno) and the Node
// integration tests both drive it. All state lives in Postgres (schema growth); this file only calls
// growth_api functions and reads the registry, so every step is safe to repeat or run concurrently.
//
// A tick: tick_begin → (stop/env checks) → ingest → dispatch events → enqueue due schedules →
// claim and run jobs until the deadline → complete each run (fenced by the lease).

/** postgres.js-style tagged template client. Only the call form is used. */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are untyped SQL results
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

export interface LlmRequest { model: string; maxTokens: number; system: string; user: string }
export interface LlmResult { text: string; tokensIn: number; tokensOut: number; stopReason: string }
export interface Llm { complete(req: LlmRequest): Promise<LlmResult> }

export interface Deps {
  sql: Sql;
  worker: string;                 // unique per process, e.g. edge-1a2b3c4d
  env: "test" | "staging" | "production";
  llm?: Llm;                      // only needed by AI tasks; absent = AI tasks fail permanently
  now?: () => number;
  deadlineMs?: number;            // stop claiming new jobs after this long (default 100 s; edge limit is 150 s)
  batch?: number;                 // jobs per claim (default 5)
  leaseSeconds?: number;          // default 300
  handlers?: Record<string, Handler>;
}

export interface ClaimedJob {
  job_id: number; run_id: number; task_key: string; task_version: number; handler: string; attempt: number;
  payload: Record<string, unknown>; approval_id: number | null; prompt_key: string | null; prompt_version: number | null;
  prompt_body: string | null; prompt_sha256: string | null; model: string | null; max_tokens: number | null;
  max_cost_usd: string | null; allowed_connectors: string[];
}

export interface HandlerResult { output?: unknown; tokensIn?: number; tokensOut?: number }
export interface Ctx {
  job: ClaimedJob;
  deps: Deps;
  /** Throws StopError when the system, this task or this connector is stopped. Call before any external effect. */
  checkStop(connector?: string): Promise<void>;
  /** Runs one external call: stop check, connector allow-list, timing, and a run_steps row. */
  step<T>(connector: string, action: string, fn: () => Promise<T>, idempotencyKey?: string): Promise<T>;
}
export type Handler = (ctx: Ctx) => Promise<HandlerResult>;

/** Do not retry (bad input, missing approval, unsupported action). */
export class PermanentError extends Error {}
/** The emergency stop or a pause was hit mid-run; the job goes back to the queue. */
export class StopError extends Error {}

const n = (v: unknown) => Number(v);

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------------------------------------
// Built-in handlers
// ------------------------------------------------------------------------------------------------
export const builtinHandlers: Record<string, Handler> = {
  "system.noop": async () => ({ output: { ok: true } }),

  // Test task. payload.fail_times = fail (retryably) on attempts 1..N; payload.permanent = fail for good;
  // payload.sleep_ms = hold the lease for a while (crash/lease tests).
  "system.echo": async ({ job }) => {
    const p = job.payload as { fail_times?: number; permanent?: boolean; sleep_ms?: number };
    const sleep = Math.min(p.sleep_ms ?? 0, 60_000);
    if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
    if (p.permanent) throw new PermanentError("echo: permanent failure requested");
    if (p.fail_times && job.attempt <= p.fail_times) throw new Error(`echo: transient failure ${job.attempt}/${p.fail_times}`);
    return { output: { echo: job.payload, attempt: job.attempt } };
  },

  "system.maintenance": async ({ deps }) => {
    const [{ r }] = await deps.sql`select growth_api.cleanup() as r`;
    return { output: r };
  },

  // Applies one approved CRM write. The approval, payload hash and single use are enforced in SQL.
  "crm.apply_update": async (ctx) => {
    await ctx.checkStop("crm");
    try {
      const [{ r }] = await ctx.deps.sql`select growth_api.crm_apply(${ctx.job.job_id}, ${ctx.deps.worker}) as r`;
      return { output: r };
    } catch (e) {
      throw new PermanentError((e as Error).message);
    }
  },

  // AI task: one bounded model call with the task's pinned, approved prompt. Payload: { input: string }.
  "llm.complete": async (ctx) => {
    const { job, deps } = ctx;
    if (!deps.llm) throw new PermanentError("no LLM configured for this worker");
    if (!job.prompt_body || !job.model) throw new PermanentError("task has no prompt or model");
    if ((await sha256Hex(job.prompt_body)) !== job.prompt_sha256) throw new PermanentError("prompt hash mismatch");
    const input = String((job.payload as { input?: unknown }).input ?? "").slice(0, 20_000);
    const res = await ctx.step("anthropic", "messages.create", () =>
      deps.llm!.complete({ model: job.model!, maxTokens: job.max_tokens ?? 2000, system: job.prompt_body!, user: input }));
    if (res.stopReason === "refusal") throw new PermanentError("model declined the request");
    return { output: { text: res.text.slice(0, 8000), stop_reason: res.stopReason }, tokensIn: res.tokensIn, tokensOut: res.tokensOut };
  },
};

// ------------------------------------------------------------------------------------------------
// Tick
// ------------------------------------------------------------------------------------------------
export interface TickSummary {
  worker: string; skipped?: string; ingested?: number; dispatched?: number; scheduled?: number;
  ran: number; results: Record<string, number>;
}

export async function tick(d: Deps): Promise<TickSummary> {
  const now = d.now ?? Date.now;
  const started = now();
  const deadline = started + (d.deadlineMs ?? 100_000);
  const handlers = { ...builtinHandlers, ...(d.handlers ?? {}) };
  const out: TickSummary = { worker: d.worker, ran: 0, results: {} };

  const [{ c }] = await d.sql`select growth_api.tick_begin(${d.worker}) as c`;
  if (c.env !== d.env) return { ...out, skipped: `env mismatch: database is ${c.env}, worker is ${d.env}` };
  if (c.global_stop) return { ...out, skipped: `stopped: ${c.stop_reason ?? ""}` };

  out.ingested = n((await d.sql`select growth_api.ingest() as n`)[0].n);
  out.dispatched = n((await d.sql`select growth_api.dispatch_events() as n`)[0].n);
  out.scheduled = n((await d.sql`select growth_api.enqueue_due_schedules() as n`)[0].n);

  while (now() < deadline) {
    const jobs = (await d.sql`select * from growth_api.claim(${d.worker}, ${d.batch ?? 5}, ${d.leaseSeconds ?? 300})`) as ClaimedJob[];
    if (!jobs.length) break;
    let stopped = false;
    for (const job of jobs) {
      const state = await runJob(d, handlers, job);
      out.ran++;
      out.results[state] = (out.results[state] ?? 0) + 1;
      if (state === "stopped") stopped = true;
    }
    if (stopped) break;
  }
  return out;
}

async function runJob(d: Deps, handlers: Record<string, Handler>, job: ClaimedJob): Promise<string> {
  const ctx: Ctx = {
    job, deps: d,
    async checkStop(connector) {
      const [{ s }] = await d.sql`select growth_api.is_stopped(${job.task_key}, ${connector ?? null}) as s`;
      if (s) throw new StopError(`stopped (task ${job.task_key}${connector ? `, connector ${connector}` : ""})`);
    },
    async step(connector, action, fn, idempotencyKey) {
      await ctx.checkStop(connector);
      if (!job.allowed_connectors.includes(connector)) throw new PermanentError(`connector ${connector} is not allowed for ${job.task_key}`);
      const t0 = Date.now();
      let code = "ok";
      try { return await fn(); } catch (e) { code = (e as Error).name || "error"; throw e; } finally {
        await d.sql`select growth_api.log_step(${job.run_id}, ${d.worker}, ${connector}, ${action}, ${null}, ${code}, ${Date.now() - t0}, ${idempotencyKey ?? null})`;
      }
    },
  };

  const handler = handlers[job.handler];
  let ok = false, retryable = true, error: string | null = null, res: HandlerResult = {};
  try {
    if (!handler) throw new PermanentError(`no handler ${job.handler} in this worker`);
    res = await handler(ctx);
    ok = true;
  } catch (e) {
    error = (e as Error).message;
    retryable = !(e instanceof PermanentError);
    if (e instanceof StopError) {
      await complete(d, job, false, true, null, error, res);
      return "stopped";
    }
  }
  return await complete(d, job, ok, retryable, ok ? res.output ?? null : null, error, res);
}

async function complete(d: Deps, job: ClaimedJob, ok: boolean, retryable: boolean, output: unknown, error: string | null, res: HandlerResult) {
  const [{ s }] = await d.sql`select growth_api.complete(${job.run_id}, ${d.worker}, ${ok}, ${retryable},
    ${output === null || output === undefined ? null : JSON.stringify(output)}::text::jsonb, ${error}, ${res.tokensIn ?? null}, ${res.tokensOut ?? null}) as s`;
  return String(s);
}
