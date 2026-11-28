// growth-worker Supabase Edge Function (Deno). Route: POST /tick, called every minute by pg_cron
// (growth.cron_tick via pg_net) with the x-growth-cron-secret header. Deploy with verify_jwt = false.
//
// Environment (Edge Function secrets, per project, never in the repo):
//   GROWTH_DB_PASSWORD      password of the growth_worker role. The worker connects as growth_worker to the host in the
//                           platform-provided SUPABASE_DB_URL; the postgres user and password in that URL are never used.
//   GROWTH_DB_URL           optional full connection string for growth_worker; overrides the two above
//   GROWTH_ENV              test | staging | production; must equal growth.control.env or the tick does nothing
//   GROWTH_WORKER_ENABLED   "false" turns every tick into a no-op without touching the database
// Vault (read per request through growth_api.secret, so rotation needs no redeploy):
//   growth_cron_secret, growth_anthropic_api_key (only when an AI task is enabled)
import postgres from "npm:postgres@3.4.5";
import Anthropic from "npm:@anthropic-ai/sdk@1";
import { type Deps, type Llm, tick } from "./core.ts";

// Connect as growth_worker only. Keep the ".<project-ref>" user suffix the pooler needs, if the platform URL has one.
export function workerDbUrl(env: (k: string) => string | undefined): string {
  const explicit = env("GROWTH_DB_URL");
  if (explicit) return explicit;
  const base = env("SUPABASE_DB_URL"), password = env("GROWTH_DB_PASSWORD");
  if (!base || !password) throw new Error("set GROWTH_DB_PASSWORD (or GROWTH_DB_URL) for the growth_worker role");
  const u = new URL(base);
  const dot = decodeURIComponent(u.username).indexOf(".");
  u.username = "growth_worker" + (dot >= 0 ? decodeURIComponent(u.username).slice(dot) : "");
  u.password = encodeURIComponent(password);
  return u.toString();
}

const sql = postgres(workerDbUrl((k) => Deno.env.get(k)), { prepare: false, max: 2, idle_timeout: 20 });
const ENV = (Deno.env.get("GROWTH_ENV") ?? "") as Deps["env"];

function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function secret(name: string): Promise<string | null> {
  const [{ v }] = await sql`select growth_api.secret(${name}) as v`;
  return v ?? null;
}

// Lazy: the key is read only when an AI task actually runs.
const llm: Llm = {
  async complete(req) {
    const apiKey = await secret("growth_anthropic_api_key");
    if (!apiKey) throw new Error("growth_anthropic_api_key is not set in Vault");
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
    const r = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      output_config: { effort: "low" },
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
    const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    return { text, tokensIn: r.usage.input_tokens, tokensOut: r.usage.output_tokens, stopReason: r.stop_reason ?? "unknown" };
  },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (Deno.env.get("GROWTH_WORKER_ENABLED") === "false") return Response.json({ skipped: "GROWTH_WORKER_ENABLED=false" });
  const expected = await secret("growth_cron_secret");
  if (!expected || !sameSecret(req.headers.get("x-growth-cron-secret") ?? "", expected)) return new Response("forbidden", { status: 403 });
  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (route !== "tick") return new Response("unknown route", { status: 404 });
  try {
    const out = await tick({ sql: sql as unknown as Deps["sql"], worker: `edge-${crypto.randomUUID().slice(0, 8)}`, env: ENV, llm });
    return Response.json(out);
  } catch (e) {
    console.error("growth tick failed", (e as Error).message);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
