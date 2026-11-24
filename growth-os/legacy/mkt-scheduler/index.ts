// mkt-scheduler Edge Function. Routes: POST /push, /reconcile, /health, /health?digest=1
// Called only by pg_cron (via pg_net) with the x-cron-secret header; deploy with verify_jwt = false.
// Secrets live in Supabase Vault and are read per request, so rotating one needs no redeploy:
//   mkt_cron_secret, mkt_buffer_api_key, mkt_buffer_org_id, mkt_meta_page_token, mkt_alert_webhook (optional)
import postgres from "npm:postgres@3.4.5";
import { type Deps, health, type Media, push, reconcile } from "./core.ts";
import { bufferProvider } from "./providers/buffer.ts";
import { metaProvider } from "./providers/meta.ts";
import { type Provider } from "./providers/types.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20 });
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function vault(): Promise<Record<string, string>> {
  const rows = await sql`select name, decrypted_secret from vault.decrypted_secrets where name like 'mkt\\_%'`;
  return Object.fromEntries(rows.map((r) => [r.name, r.decrypted_secret]));
}

function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Signed Storage URL that outlives the push window (Buffer/Meta fetch media when the post goes out).
async function mediaFor(creativeId: string): Promise<Media | null> {
  const [c] = await sql`select kind, storage_path, ai_generated from marketing.creatives where id = ${creativeId}`;
  if (!c?.storage_path) return null;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${c.storage_path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 21 }),
  });
  if (!res.ok) throw new Error(`could not sign ${c.storage_path}: HTTP ${res.status}`);
  const { signedURL } = await res.json();
  return { type: c.kind, url: `${SUPABASE_URL}/storage/v1${signedURL}`, aiGenerated: c.ai_generated };
}

function deps(secrets: Record<string, string>): Deps {
  const providers: Partial<Record<string, Provider>> = {};
  if (secrets.mkt_buffer_api_key && secrets.mkt_buffer_org_id) providers.buffer = bufferProvider(secrets.mkt_buffer_api_key, secrets.mkt_buffer_org_id);
  if (secrets.mkt_meta_page_token) providers.meta = metaProvider(secrets.mkt_meta_page_token);
  return {
    sql: sql as any,
    providers,
    mediaFor,
    worker: `edge-${crypto.randomUUID().slice(0, 8)}`,
    async alert(kind, message, detail) {
      // Always logged; webhook at most once per kind per 12 h so a standing problem doesn't spam.
      const [{ recent }] = await sql`select exists (select 1 from marketing.events where kind = ${"alert:" + kind}
                                       and at > now() - interval '12 hours') as recent`;
      await sql`insert into marketing.events(actor, kind, detail) values ('scheduler', ${"alert:" + kind}, ${JSON.stringify({ message, detail })}::jsonb)`;
      if ((recent && kind !== "digest") || !secrets.mkt_alert_webhook) return;
      await fetch(secrets.mkt_alert_webhook, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "built2bid-scheduler", kind, message }) }).catch(() => {});
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secrets = await vault();
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!secrets.mkt_cron_secret || !sameSecret(given, secrets.mkt_cron_secret)) return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  const route = url.pathname.split("/").filter(Boolean).pop();
  const d = deps(secrets);
  try {
    const out = route === "push" ? await push(d)
      : route === "reconcile" ? await reconcile(d)
      : route === "health" ? await health(d, url.searchParams.get("digest") === "1")
      : null;
    if (!out) return new Response("unknown route", { status: 404 });
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
