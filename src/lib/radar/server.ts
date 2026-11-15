import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiConfigured } from "@/lib/ai/provider";
import { classify, sanitizeUntrusted, score } from "./classify";
import { draftFirstReply, draftFollowUpReply, similarityFlag, type DraftResult } from "./draft";
import { aiFirstReply, RADAR_AI_VERSION } from "./draft-ai";
import { importsToday, usageSummary, type DraftRow, type OppRow, type UsageRow } from "./report";
import { defaultState, getSource, linksAllowed, SOURCES, type SourceState } from "./sources";
import { canDraft, canLogFollowUp } from "./state";
import { parseDiscussionUrl } from "./url";

/**
 * Opportunity Radar data access. Every caller must have passed requireAdmin() first; `db` is the
 * service-role client. Nothing in this module contacts an external platform.
 */
type Db = SupabaseClient;

export interface RadarSettings { monthly_budget_usd: number; ai_drafting_enabled: boolean; max_imports_per_day: number; retention_days: number }
export const DEFAULT_SETTINGS: RadarSettings = { monthly_budget_usd: 5, ai_drafting_enabled: false, max_imports_per_day: 50, retention_days: 90 };

export interface RadarData {
  installed: boolean;
  opps: OppRow[];
  drafts: DraftRow[];
  states: Map<string, SourceState>;
  usage: UsageRow[];
  settings: RadarSettings;
}

const missing = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "")));

export async function loadRadar(db: Db): Promise<RadarData> {
  const since = new Date(Date.now() - 62 * 86_400_000).toISOString();
  const [o, d, s, u, st] = await Promise.all([
    db.from("radar_opportunities").select("*").order("created_at", { ascending: false }).limit(1000),
    db.from("radar_drafts").select("id,opportunity_id,reply_number,follow_up_text,parent_reply_ref,body,engine,flags,flags_acknowledged,similarity_max,status,approved_at,posted_at,posted_url,platform_reply_id,publish_error,created_at").order("created_at", { ascending: false }).limit(3000),
    db.from("radar_source_state").select("*"),
    db.from("radar_usage").select("kind,source_key,cost_usd,quota_units,input_tokens,output_tokens,created_at").gte("created_at", since).limit(10000),
    db.from("radar_settings").select("monthly_budget_usd,ai_drafting_enabled,max_imports_per_day,retention_days").maybeSingle(),
  ]);
  if (missing(o.error)) return { installed: false, opps: [], drafts: [], states: new Map(), usage: [], settings: DEFAULT_SETTINGS };
  for (const r of [o, d, s, u, st]) if (r.error) throw new Error(`Opportunity Radar load failed: ${r.error.message}`);
  const states = new Map<string, SourceState>(SOURCES.map((x) => [x.key, defaultState(x.key)]));
  for (const row of (s.data ?? []) as SourceState[]) states.set(row.source_key, { ...defaultState(row.source_key), ...row });
  const settings = st.data ? { ...DEFAULT_SETTINGS, ...st.data, monthly_budget_usd: Number(st.data.monthly_budget_usd) } : DEFAULT_SETTINGS;
  return { installed: true, opps: (o.data ?? []) as OppRow[], drafts: (d.data ?? []) as DraftRow[], states, usage: (u.data ?? []) as UsageRow[], settings };
}

export async function loadOpportunity(db: Db, id: string) {
  const [o, d] = await Promise.all([
    db.from("radar_opportunities").select("*").eq("id", id).maybeSingle(),
    db.from("radar_drafts").select("*").eq("opportunity_id", id).order("created_at", { ascending: true }),
  ]);
  if (o.error) throw new Error(o.error.message);
  return { opp: (o.data ?? null) as OppRow | null, drafts: (d.data ?? []) as DraftRow[] };
}

async function sourceState(db: Db, key: string): Promise<SourceState> {
  const { data } = await db.from("radar_source_state").select("*").eq("source_key", key).maybeSingle();
  return data ? { ...defaultState(key), ...(data as SourceState) } : defaultState(key);
}

async function settings(db: Db): Promise<RadarSettings> {
  const { data } = await db.from("radar_settings").select("monthly_budget_usd,ai_drafting_enabled,max_imports_per_day,retention_days").maybeSingle();
  return data ? { ...DEFAULT_SETTINGS, ...data, monthly_budget_usd: Number(data.monthly_budget_usd) } : DEFAULT_SETTINGS;
}

async function monthUsage(db: Db): Promise<UsageRow[]> {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const { data } = await db.from("radar_usage").select("kind,source_key,cost_usd,quota_units,input_tokens,output_tokens,created_at").gte("created_at", start.toISOString()).limit(10000);
  return (data ?? []) as UsageRow[];
}

/** Map database guard errors to plain owner-facing messages. */
export function radarError(message: string | undefined): string {
  const m = message ?? "";
  if (/radar_reply_cap/.test(m)) return "This conversation already used its two replies. Reopen it if a customer still needs help.";
  if (/radar_reply_order/.test(m)) return "That reply is out of order. Refresh the page.";
  if (/radar_closed/.test(m)) return "This discussion is rejected or archived.";
  if (/radar_approval_required/.test(m)) return "Approve the draft first.";
  if (/radar_unconfirmed/.test(m)) return "Not marked published: the platform did not confirm the reply.";
  if (/radar_immutable/.test(m)) return "Posted replies are kept as history and can't be changed.";
  if (/radar_bad_transition/.test(m)) return "That action isn't available in the current state. Refresh the page.";
  if (/radar_reason_required/.test(m)) return "Add a short reason for reopening.";
  if (/radar_drafts_live_uq|duplicate key/.test(m)) return "There's already an open draft for this discussion.";
  return "Something went wrong. Nothing was changed.";
}

// ---------------------------------------------------------------------------------------------
// Manual import (the only discovery path in this release)
// ---------------------------------------------------------------------------------------------
export interface ImportInput { url: string; title: string; text: string; postedAt?: string | null; replyCount?: number | null; replyAllowed: boolean }
export type ImportResult = { ok: true; id: string } | { ok: false; duplicateId?: string; error: string };

export async function importDiscussion(db: Db, userId: string, input: ImportInput, now = new Date()): Promise<ImportResult> {
  let parsed;
  try { parsed = parseDiscussionUrl(input.url); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const st = await settings(db);
  const usage = await monthUsage(db);
  if (importsToday(usage, now) >= st.max_imports_per_day) return { ok: false, error: `Daily import limit reached (${st.max_imports_per_day}). Raise it in Radar settings if you need more.` };

  const dupe = await db.from("radar_opportunities").select("id").eq("url_hash", parsed.urlHash).maybeSingle();
  if (dupe.data) return { ok: false, duplicateId: dupe.data.id, error: "Already imported." };
  if (parsed.threadId) {
    const t = await db.from("radar_opportunities").select("id").eq("source_key", parsed.source.key).eq("platform_thread_id", parsed.threadId).maybeSingle();
    if (t.data) return { ok: false, duplicateId: t.data.id, error: "Already imported (same discussion, different link)." };
  }

  const title = sanitizeUntrusted(input.title, 300) || "(untitled discussion)";
  const text = sanitizeUntrusted(input.text, 1500);
  const d = { title, text, postedAt: input.postedAt ?? null, replyCount: input.replyCount ?? null, replyAllowed: input.replyAllowed };
  const c = classify(d);
  const s = score(d, c, now);
  const status = c.priority === "X" ? "archived" : "new";
  const ins = await db.from("radar_opportunities").insert({
    source_key: parsed.source.key, canonical_url: parsed.canonicalUrl, url_hash: parsed.urlHash, platform_thread_id: parsed.threadId,
    title, excerpt: text || null, posted_at: d.postedAt, reply_count: d.replyCount, reply_allowed: d.replyAllowed,
    priority: c.priority, trade: c.trade, topics: c.topics, pain_points: c.painPoints, score: s.total, score_factors: s.factors,
    status, injection_suspected: c.injectionSuspected, created_by: userId,
  }).select("id").single();
  if (ins.error) return { ok: false, error: /duplicate key/.test(ins.error.message) ? "Already imported." : radarError(ins.error.message) };
  await db.from("radar_usage").insert({ kind: "import", source_key: parsed.source.key, cost_usd: 0 });
  return { ok: true, id: ins.data.id };
}

// ---------------------------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------------------------
async function recentReplies(db: Db, excludeOpp: string): Promise<string[]> {
  const { data } = await db.from("radar_drafts").select("body,opportunity_id").in("status", ["approved", "posted_manual", "published", "publish_pending"]).order("created_at", { ascending: false }).limit(100);
  return (data ?? []).filter((r) => r.opportunity_id !== excludeOpp).map((r) => r.body as string);
}

function oppState(o: OppRow) { return { status: o.status, owner_replies_used: o.owner_replies_used, reopened: o.reopened }; }

export type DraftOutcome = { ok: true; draftId: string; engine: "rules" | "ai"; notice?: string } | { ok: false; error: string };

export async function createFirstDraft(db: Db, userId: string, o: OppRow, opts: { useAi?: boolean } = {}): Promise<DraftOutcome> {
  const check = canDraft(oppState(o), 1);
  if (!check.ok) return { ok: false, error: check.reason };
  if (!o.reply_allowed) return { ok: false, error: "You marked this discussion as not allowing replies." };
  if (o.content_removed_at) return { ok: false, error: "The author removed this discussion." };
  const src = getSource(o.source_key);
  if (!src) return { ok: false, error: "Unknown source." };
  const state = await sourceState(db, o.source_key);
  const text = o.excerpt ?? "";
  const c = classify({ title: o.title, text });
  if (c.priority === "X") return { ok: false, error: "This discussion isn't about estimating or bidding, so no reply is suggested." };
  const ctx = { seed: o.id, sourceKey: o.source_key, title: o.title, text, classification: c, linksAllowed: linksAllowed(o.source_key, state), allowProductMention: o.allow_product_mention };

  let result: DraftResult | null = null;
  let engine: "rules" | "ai" = "rules";
  let notice: string | undefined;
  const rules = draftFirstReply(ctx);
  if (!rules) return { ok: false, error: "No reply suggested for this discussion." };

  if (opts.useAi) {
    const st = await settings(db);
    const u = usageSummary(await monthUsage(db), st.monthly_budget_usd);
    if (!st.ai_drafting_enabled) notice = "AI drafting is off in Radar settings, so this was drafted from rules.";
    else if (!isAiConfigured()) notice = "No AI key is configured, so this was drafted from rules.";
    else if (u.overBudget) notice = `This month's Radar AI budget ($${st.monthly_budget_usd}) is used up, so this was drafted from rules.`;
    else {
      const ai = await aiFirstReply(ctx, rules.mentionsProduct);
      if (ai.usage) await db.from("radar_usage").insert({ kind: "ai_draft", source_key: o.source_key, model: ai.usage.model, input_tokens: ai.usage.inputTokens, output_tokens: ai.usage.outputTokens, cost_usd: ai.usage.costUsd });
      if (ai.result && !ai.result.flags.some((f) => f.kind === "missing_disclosure" || f.kind === "link_not_allowed")) { result = ai.result; engine = "ai"; }
      else notice = `AI draft ${ai.error ? "failed" : "didn't pass the checks"}, so this was drafted from rules.`;
    }
  }
  result ??= rules;
  const sim = similarityFlag(result.body, await recentReplies(db, o.id));
  const flags = sim.flag ? [...result.flags, sim.flag] : result.flags;
  const ins = await db.from("radar_drafts").insert({
    opportunity_id: o.id, reply_number: 1, body: result.body, engine, flags, similarity_max: Math.round(sim.max * 1000) / 1000, created_by: userId,
  }).select("id").single();
  if (ins.error) return { ok: false, error: radarError(ins.error.message) };
  if (result.flags.some((f) => f.kind === "unsupported_claim")) await db.from("radar_opportunities").update({ flagged_unsupported: true }).eq("id", o.id);
  return { ok: true, draftId: ins.data.id, engine, notice: notice ?? (engine === "ai" ? `Drafted with AI (${RADAR_AI_VERSION}).` : undefined) };
}

export async function logFollowUp(db: Db, userId: string, o: OppRow, followUp: string, parentRef: string | null): Promise<DraftOutcome> {
  const check = canLogFollowUp(oppState(o));
  if (!check.ok) return { ok: false, error: check.reason };
  const next = o.owner_replies_used + 1;
  const dc = canDraft(oppState(o), next);
  if (!dc.ok) return { ok: false, error: dc.reason };
  const { data: prior } = await db.from("radar_drafts").select("body,posted_url,platform_reply_id").eq("opportunity_id", o.id).in("status", ["posted_manual", "published"]).order("reply_number", { ascending: false }).limit(1).maybeSingle();
  const text = sanitizeUntrusted(followUp, 2000);
  if (text.length < 2) return { ok: false, error: "Paste the person's reply first." };
  const c = classify({ title: o.title, text: o.excerpt ?? "" });
  const r = draftFollowUpReply({ seed: `${o.id}:${next}`, sourceKey: o.source_key, followUp: text, classification: c, firstReply: prior?.body ?? "" });
  const flags = o.reopened ? [...r.flags, { kind: "needs_verification", reason: "Reopened conversation: answer the customer's actual need personally" }] : r.flags;
  const ins = await db.from("radar_drafts").insert({
    opportunity_id: o.id, reply_number: next, follow_up_text: text,
    parent_reply_ref: parentRef || prior?.platform_reply_id || prior?.posted_url || null,
    body: r.body, engine: "rules", flags, created_by: userId,
  }).select("id").single();
  if (ins.error) return { ok: false, error: radarError(ins.error.message) };
  return { ok: true, draftId: ins.data.id, engine: "rules", notice: r.reviewReason };
}
