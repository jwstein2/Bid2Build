import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { metaReady, trialConfig } from "@/lib/trial/config";
import { processMetaPayload, type MetaPayload } from "@/lib/trial/flow";
import { verifyMetaSignature } from "@/lib/trial/meta";
import { metaFlowDeps } from "@/lib/trial/service";

export const runtime = "nodejs";
export const maxDuration = 25;

/**
 * Meta webhook for the Facebook comment-to-trial funnel (Page "feed" + Messenger "messages" /
 * "messaging_postbacks"). Callback URL: https://built2bid.org/api/webhooks/meta
 *
 * GET  : Meta's subscription check (hub.verify_token must equal META_VERIFY_TOKEN).
 * POST : X-Hub-Signature-256 is verified against the exact raw body with META_APP_SECRET before
 *        anything is parsed. Only the configured Page and post ids are acted on, edits are ignored,
 *        and every comment / message id is processed once. While FB_TRIAL_ENABLED is not "true" the
 *        endpoint verifies and acknowledges deliveries but sends nothing.
 * Logs carry counts and error codes only: no tokens, names, PSIDs, message text or emails.
 */
export async function GET(req: Request) {
  const cfg = trialConfig();
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token") ?? "";
  const challenge = u.searchParams.get("hub.challenge") ?? "";
  if (!cfg.verifyToken) return new Response("Webhook not configured", { status: 503 });
  const a = Buffer.from(token), b = Buffer.from(cfg.verifyToken);
  if (mode !== "subscribe" || a.length !== b.length || !timingSafeEqual(a, b) || !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: Request) {
  const cfg = trialConfig();
  if (!cfg.appSecret || !isSupabaseConfigured()) return new Response("Webhook not configured", { status: 503 });
  const raw = await req.text();
  if (raw.length > 512_000) return new Response("Too large", { status: 413 });
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret)) return new Response("Bad signature", { status: 401 });
  let payload: MetaPayload;
  try { payload = JSON.parse(raw) as MetaPayload; } catch { return new Response("Bad JSON", { status: 400 }); }

  // Campaign paused or not fully configured: acknowledge so Meta doesn't retry, do nothing.
  if (!cfg.enabled || !metaReady(cfg)) return new Response("paused", { status: 200 });

  try {
    const summary = await processMetaPayload(payload, metaFlowDeps(createAdminClient(), cfg));
    if (summary.comments || summary.messages) console.info(JSON.stringify({ level: "info", scope: "meta.webhook", ...summary }));
    return new Response("ok", { status: 200 });
  } catch (e) {
    // Storage trouble: let Meta retry (dedupe keys make the retry safe).
    logError("meta.webhook", e);
    return new Response("retry", { status: 500 });
  }
}
