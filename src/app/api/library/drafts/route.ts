import { createHash } from "node:crypto";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, rateLimit, sameOrigin } from "@/lib/http/api";
import { AiUnavailableError, isAiConfigured } from "@/lib/ai/provider";
import { adminOrNull, checkAiBudget, logAiGeneration } from "@/lib/ai/budget";
import { getTrade, tradeName } from "@/lib/trades/catalog";
import { generateLibrary, type GenerateOutcome } from "@/lib/library-generator/generate";
import { GENERATOR_VERSION, draftTitle, generateRequestSchema, modeFor, normalizedName } from "@/lib/library-generator/model";
import { candidateRow, generatorReady, loadBidOutline, loadDetail, loadHistory, loadSavedItems, mapDraft, stackRow } from "@/lib/library-generator/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A draft stuck in "generating" this long (closed tab, timeout) can be generated again. */
const STALE_MS = 2 * 60_000;

/**
 * "Generate My Price Library" drafts for the signed-in contractor (own rows only, RLS).
 * GET lists them; POST runs one AI batch into a new or existing draft. Nothing here writes to
 * saved_items or assemblies: approval is a separate, explicit step (./[id] → approve).
 */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("library_drafts").select("*").neq("status", "archived").order("updated_at", { ascending: false }).limit(30);
  if (error) return json({ ready: false, aiReady: isAiConfigured(), drafts: [] });
  const ids = (data ?? []).map((d: any) => d.id);
  const { data: counts } = ids.length
    ? await supabase.from("library_draft_items").select("draft_id, status").in("draft_id", ids).limit(20000)
    : { data: [] as any[] };
  return json({
    ready: true,
    aiReady: isAiConfigured(),
    drafts: (data ?? []).map((d: any) => {
      const rows = (counts ?? []).filter((c: any) => c.draft_id === d.id);
      return { ...mapDraft(d), itemCount: rows.filter((r: any) => r.status !== "removed").length, candidateCount: rows.filter((r: any) => r.status === "candidate").length };
    }),
  });
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("library-gen", 5, 60_000))) return fail(429, "rate_limited", "That's a lot of generating at once. Please wait a minute and try again.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in to generate your price library.");
  const parsed = generateRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Describe your trade or scope in up to 2,000 characters.");
  const input = parsed.data;
  const supabase = await createClient();
  if (!(await generatorReady(supabase))) return fail(503, "not_ready", "Price library generation is coming soon.");

  const trades = [...new Set(input.trades.filter((t) => getTrade(t)))];
  if (input.trades.length && !trades.length) return fail(400, "invalid_trade", "Pick a trade from the list.");

  // Continue an existing draft, or start a new one.
  let draft: any = null;
  if (input.draftId) {
    const { data } = await supabase.from("library_drafts").select("*").eq("id", input.draftId).maybeSingle();
    if (!data) return fail(404, "not_found", "That draft no longer exists.");
    if (data.status === "archived") return fail(409, "archived", "Restore this draft before adding to it.");
    if (data.status === "generating" && Date.now() - Date.parse(data.updated_at) < STALE_MS) return fail(409, "busy", "This draft is still generating. It will be ready in a moment.");
    draft = data;
  } else if (!input.prompt.trim() && !trades.length && !input.estimateId) {
    return fail(400, "invalid", "Pick a trade or describe your work.");
  }

  const draftTrades = draft ? (draft.trades as string[]) : trades;
  const prompt = draft ? (draft.prompt as string) : input.prompt.trim();
  const estimateId = draft ? (draft.source_estimate_id as string | null) ?? undefined : input.estimateId;

  // The same new request in the last 24 hours returns that draft instead of paying for it again.
  const hash = createHash("sha256").update(JSON.stringify({ v: GENERATOR_VERSION, p: normalizedName(prompt), t: [...draftTrades].sort(), e: estimateId ?? null })).digest("hex");
  if (!draft && !input.force) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: same } = await supabase.from("library_drafts").select("id, status").eq("input_hash", hash).gte("created_at", since)
      .not("status", "in", "(failed,archived)").order("created_at", { ascending: false }).limit(1);
    if (same?.length) {
      const detail = await loadDetail(supabase, same[0].id);
      if (detail) return json({ ...detail, reused: true });
    }
  }

  if (!isAiConfigured()) return fail(503, "ai_unavailable", "Price library generation isn't available right now. Please try again later.");
  const db = adminOrNull();
  const budget = await checkAiBudget(db, user.id);
  if (!budget.ok) return budget.reason === "daily_limit"
    ? fail(429, "daily_limit", "You've reached today's AI limit. Your draft is saved; you can keep reviewing it. Generating resets in 24 hours.")
    : fail(503, "ai_unavailable", "Generating is paused for the rest of the month. Your drafts are saved and you can keep reviewing them.");

  let bidOutline: string | undefined;
  if (estimateId) {
    const bid = await loadBidOutline(supabase, estimateId);
    if (!bid) return fail(404, "not_found", "That bid isn't available.");
    bidOutline = bid.outline;
    if (!draftTrades.length) draftTrades.push(...bid.trades.filter((t) => getTrade(t)).slice(0, 4));
  }

  const previousStatus: string = draft?.status ?? "draft";
  if (!draft) {
    const { data: companyId } = await supabase.rpc("my_company_id");
    const { data, error } = await supabase.from("library_drafts").insert({
      user_id: user.id, company_id: companyId ?? null, title: draftTitle(prompt, draftTrades.map(tradeName)), prompt, trades: draftTrades,
      mode: modeFor(prompt, estimateId), source_estimate_id: estimateId ?? null, status: "generating", generator_version: GENERATOR_VERSION, input_hash: hash,
    }).select("*").single();
    if (error || !data) return fail(500, "save_failed", "Could not start your draft. Please try again.");
    draft = data;
  } else {
    await supabase.from("library_drafts").update({ status: "generating", last_error: null }).eq("id", draft.id);
  }

  const [saved, history, { data: existing }] = await Promise.all([
    loadSavedItems(supabase),
    loadHistory(supabase, user.id),
    supabase.from("library_draft_items").select("id, name, category, status, unit_cost, sort_order").eq("draft_id", draft.id).limit(2000),
  ]);
  const live = (existing ?? []).filter((r: any) => r.status !== "removed");
  const tradeSet = new Set(draftTrades);
  const avoidNames = [
    ...live.filter((r: any) => !(input.regenerate && input.category && r.category.toLowerCase() === input.category.toLowerCase() && r.status === "candidate")).map((r: any) => r.name),
    ...saved.filter((s) => !tradeSet.size || !s.trade || tradeSet.has(s.trade)).map((s) => s.name),
  ].slice(0, 150);

  let out: GenerateOutcome | null = null;
  let usage: GenerateOutcome["usage"] | undefined;
  try {
    out = await generateLibrary({
      prompt, trades: draftTrades, focus: input.focus, category: input.category, avoidNames,
      existingCategories: [...new Set(live.map((r: any) => r.category as string))], bidOutline, draftNames: live.map((r: any) => r.name),
    });
    usage = out.usage;
  } catch (e) {
    if (e instanceof AiUnavailableError && e.usage) usage = { ...e.usage, costUsd: 0 };
  }
  await logAiGeneration(db, { userId: user.id, kind: "library_generate", trade: draftTrades[0] ?? null, status: out ? "ok" : "failed", usage }, { generator: GENERATOR_VERSION, focus: input.focus });

  if (!out) {
    const first = !input.draftId;
    await supabase.from("library_drafts").update({
      status: first ? "failed" : previousStatus === "generating" ? "draft" : previousStatus,
      last_error: "The AI couldn't finish this batch.",
    }).eq("id", draft.id);
    return fail(502, "generate_failed", first
      ? "We couldn't build this catalog right now. Try again, or add a little more detail about the work you do."
      : "We couldn't add that batch right now. Your draft is unchanged; try again in a moment.", { draftId: draft.id });
  }

  // Regenerate a category: unpriced candidates there are set aside (kept, marked removed).
  if (input.regenerate && input.category) {
    const ids = live.filter((r: any) => r.status === "candidate" && r.unit_cost === null && r.category.toLowerCase() === input.category!.toLowerCase()).map((r: any) => r.id);
    if (ids.length) await supabase.from("library_draft_items").update({ status: "removed" }).in("id", ids);
  }

  const batch = (draft.generation_count ?? 0) + 1;
  let order = live.reduce((m: number, r: any) => Math.max(m, r.sort_order ?? 0), 0);
  const rows = out.items.map((c) => candidateRow(c, { draftId: draft.id, userId: user.id, batch, sortOrder: ++order, saved, history }));
  const { data: inserted, error: insErr } = rows.length ? await supabase.from("library_draft_items").insert(rows).select("id, name") : { data: [] as any[], error: null };
  if (insErr) {
    await supabase.from("library_drafts").update({ status: input.draftId ? (previousStatus === "generating" ? "draft" : previousStatus) : "failed", last_error: "Could not save the batch." }).eq("id", draft.id);
    return fail(500, "save_failed", "Could not save the generated items. Please try again.", { draftId: draft.id });
  }
  const idByName = new Map<string, string>([...live.map((r: any) => [String(r.name).toLowerCase(), r.id] as const), ...(inserted ?? []).map((r: any) => [String(r.name).toLowerCase(), r.id] as const)]);
  const { count: stackCount } = await supabase.from("library_draft_stacks").select("id", { count: "exact", head: true }).eq("draft_id", draft.id);
  const stackRows = out.stacks.map((s, k) => stackRow(s, { draftId: draft.id, userId: user.id, sortOrder: (stackCount ?? 0) + k + 1, idByName })).filter((r): r is NonNullable<typeof r> => r !== null);
  if (stackRows.length) await supabase.from("library_draft_stacks").insert(stackRows);

  const keepStatus = ["under_review", "partially_approved"].includes(previousStatus) ? previousStatus : "draft";
  await supabase.from("library_drafts").update({
    status: previousStatus === "approved" ? "partially_approved" : keepStatus,
    generation_count: batch,
    notes: [...new Set([...(draft.notes ?? []), ...out.notes])].slice(0, 10),
    last_error: null,
  }).eq("id", draft.id);

  const detail = await loadDetail(supabase, draft.id);
  return json({ ...detail, added: { items: rows.length, stacks: stackRows.length } });
}
