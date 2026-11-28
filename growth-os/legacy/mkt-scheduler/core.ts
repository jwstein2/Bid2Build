// Scheduler logic, independent of the runtime: index.ts (Deno) and the Node tests both drive it.
// All state lives in Postgres; every step is safe to run twice or concurrently.
import { type Provider, type SubmitInput, type SubmitResult } from "./providers/types.ts";

// postgres.js tagged-template client (npm:postgres). Only the call form is used.
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;
export type Media = { type: "image" | "video"; url: string; aiGenerated: boolean };

export interface Deps {
  sql: Sql;
  providers: Partial<Record<string, Provider>>;  // only configured providers are present
  mediaFor(creativeId: string): Promise<Media | null>;
  worker: string;
  alert(kind: string, message: string, detail?: unknown): Promise<void>;
}

async function withRun<T extends Record<string, unknown>>(d: Deps, job: string, fn: () => Promise<T>): Promise<T> {
  const [{ id }] = await d.sql`insert into marketing.runs(job) values (${job}) returning id`;
  try {
    const summary = await fn();
    await d.sql`update marketing.runs set finished_at = now(), ok = true, summary = ${JSON.stringify(summary)}::jsonb where id = ${id}`;
    return summary;
  } catch (e) {
    const msg = (e as Error).message;
    await d.sql`update marketing.runs set finished_at = now(), ok = false, summary = ${JSON.stringify({ error: msg })}::jsonb where id = ${id}`;
    await d.alert(`run_failed:${job}`, `Scheduler ${job} run failed: ${msg}`);
    throw e;
  }
}

async function recordSubmit(d: Deps, jobId: string | number, r: SubmitResult | { outcome: "found_existing"; providerPostId: string }) {
  const post = "providerPostId" in r ? r.providerPostId : null;
  const code = "code" in r ? r.code : null;
  const detail = "detail" in r ? r.detail : null;
  const [{ s }] = await d.sql`select marketing.record_submit(${jobId}, ${r.outcome}, ${post}, ${code}, ${detail}) as s`;
  return s as string;
}

// Pre-flight checks against what the provider can actually do. Failing here never calls the provider.
function preflight(p: Provider, c: any, media: Media | null): SubmitResult | null {
  const cap = p.capabilities;
  if (!cap.kinds.includes(c.kind)) return { outcome: "rejected", code: "KIND_UNSUPPORTED", detail: `${p.name} cannot publish ${c.kind}` };
  if (media && !cap.media[media.type]) return { outcome: "rejected", code: "MEDIA_UNSUPPORTED", detail: `${p.name} cannot take ${media.type}` };
  if ((c.kind === "reel") && media?.type !== "video") return { outcome: "rejected", code: "NO_VIDEO", detail: "reel needs a video" };
  if (media?.aiGenerated && cap.aiLabel !== "supported")
    return { outcome: "rejected", code: "AI_LABEL_UNSUPPORTED", detail: `${p.name} cannot set Meta's AI label; route this item through the meta channel` };
  const leadDays = (new Date(c.publish_at).getTime() - Date.now()) / 864e5;
  if (leadDays > cap.scheduling.maxLeadDays) return { outcome: "error", code: "TOO_FAR_AHEAD", detail: `${p.name} schedules at most ${cap.scheduling.maxLeadDays} days ahead` };
  return null;
}

// PUSH: hand approved items inside the push window to the provider's native scheduler.
export function push(d: Deps, limit = 10) {
  return withRun(d, "push", async () => {
    const [{ n: recovered }] = await d.sql`select marketing.recover_stale(10) as n`;
    const claimed = await d.sql`select * from marketing.claim_due(${d.worker}, ${limit})`;
    const out: Record<string, number> = {};
    const bump = (k: string) => (out[k] = (out[k] ?? 0) + 1);

    for (const c of claimed) {
      const p = d.providers[c.provider];
      let res: SubmitResult | { outcome: "found_existing"; providerPostId: string };
      try {
        if (!p) {
          res = { outcome: "error", code: "PROVIDER_NOT_CONFIGURED", detail: `no credentials for ${c.provider} in Vault` };
        } else {
          const media = c.creative_id ? await d.mediaFor(c.creative_id) : null;
          if (c.creative_id && !media) {
            res = { outcome: "rejected", code: "MEDIA_MISSING", detail: "creative has no storage object to share" };
          } else {
            const publishAt = new Date(c.publish_at);
            // A retry may follow a send that actually landed: look before sending again.
            const existing = c.attempt > 1 ? await p.findExisting({ channelId: c.provider_channel_id, caption: c.caption, publishAt }) : null;
            if (existing) res = { outcome: "found_existing", providerPostId: existing };
            else {
              res = preflight(p, c, media) ?? await p.submit({
                idempotencyKey: c.idempotency_key, channelId: c.provider_channel_id, kind: c.kind, caption: c.caption,
                linkUrl: c.link_url, publishAt, publishNow: c.publish_now, media,
              } satisfies SubmitInput);
            }
          }
        }
      } catch (e) {
        // A throw from the adapter after the request may have gone out: treat as unknown, verify later.
        res = { outcome: "timeout", code: "EXCEPTION", detail: (e as Error).message };
      }
      const status = await recordSubmit(d, c.job_id, res);
      bump(status);
      if (status === "failed") await d.alert("item_failed", `Post ${c.content_key} failed: ${"detail" in res ? res.detail : ""}`, { content_key: c.content_key });
    }
    return { recovered, claimed: claimed.length, ...out };
  });
}

// RECONCILE: ask the provider what happened to items we handed over (or lost the answer for).
export function reconcile(d: Deps, limit = 50) {
  return withRun(d, "reconcile", async () => {
    const due = await d.sql`select * from marketing.due_for_reconcile(${limit})`;
    const out: Record<string, number> = { checked: due.length, lookup_errors: 0 };
    for (const r of due) {
      const p = d.providers[r.provider];
      if (!p) { out.lookup_errors++; continue; }
      try {
        const st = await p.status({ channelId: r.provider_channel_id, providerPostId: r.provider_post_id, caption: r.caption, publishAt: new Date(r.publish_at) });
        const [{ s }] = await d.sql`select marketing.record_status(${r.content_id}, ${st.state},
          ${"providerPostId" in st ? st.providerPostId ?? null : null}, ${"url" in st ? st.url ?? null : null},
          ${"publishedAt" in st && st.publishedAt ? st.publishedAt.toISOString() : null}, ${"detail" in st ? st.detail : null}) as s`;
        out[s] = (out[s] ?? 0) + 1;
        if (s === "failed" || s === "needs_review") await d.alert(`item_${s}`, `Post ${r.content_key} is ${s}`, { content_key: r.content_key });
      } catch {
        out.lookup_errors++;   // provider unreachable: leave the item as is, try next run
      }
    }
    return out;
  });
}

// HEALTH: check every channel's connection and the queue; alert on anything that needs James.
export function health(d: Deps, digest = false) {
  return withRun(d, digest ? "digest" : "health", async () => {
    const chans = await d.sql`select id, provider, provider_channel_id, display_name, status from marketing.channels where status in ('connected','needs_reauth')`;
    const channels: Record<string, string> = {};
    for (const c of chans) {
      const p = d.providers[c.provider];
      let h = { ok: false, detail: `no credentials for ${c.provider}` };
      if (p) { try { h = await p.health(c.provider_channel_id); } catch (e) { h = { ok: false, detail: (e as Error).message }; } }
      const [{ s }] = await d.sql`select marketing.record_health(${c.id}, ${h.ok}, ${h.detail}) as s`;
      channels[c.display_name] = h.ok ? "ok" : `${s}: ${h.detail}`;
      if (!h.ok && c.status === "connected") await d.alert("channel_down", `${c.display_name} needs attention: ${h.detail}`);
    }
    const [{ q }] = await d.sql`select marketing.queue_health() as q`;
    const [{ reserve }] = await d.sql`select coalesce((targets->>'reserve_days')::int, 14) as reserve from marketing.settings where id = 1`;
    const problems: string[] = [];
    if (!q.paused && q.days_covered_next_14 < Math.min(7, reserve)) problems.push(`only ${q.days_covered_next_14} of the next 14 days have posts queued`);
    if (q.needs_review > 0) problems.push(`${q.needs_review} item(s) need review`);
    if (q.stuck_submitting > 0) problems.push(`${q.stuck_submitting} item(s) stuck submitting`);
    if (q.failed_7d > 0) problems.push(`${q.failed_7d} failure(s) in 7 days`);
    if (problems.length && !digest) await d.alert("queue", problems.join("; "), q);
    if (digest) await d.alert("digest", `Weekly: ${q.days_covered_next_14}/14 days queued, ${q.awaiting_approval} awaiting approval${problems.length ? "; " + problems.join("; ") : ""}`, q);
    return { channels, queue: q, problems };
  });
}
