import { z } from "zod/v4";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { AiUnavailableError, DEFAULT_MODEL, generateStructured, isAiConfigured } from "@/lib/ai/provider";
import { preflightAi } from "@/lib/ai/guard";
import { filterSuggestions, PHOTO_LABELS } from "@/lib/operations/photo-labels";
import { isPhotoAiEnabled, photoAiAllowedFor } from "@/lib/operations/photos-server";
import { UUID } from "@/lib/operations/server";

export const runtime = "nodejs";
const out = z.object({ labels: z.array(z.string()).max(8) });

/**
 * Suggest labels for one photo (only when PHOTO_AI_LABELS=on and an AI key is configured, and only
 * when the person asks). Sends the small preview to Claude Haiku; suggestions stay marked as
 * suggestions until someone accepts or corrects them. Never changes costs or anything customer-facing.
 * A company (or solo owner) that turned Photo labeling OFF in Company → AI & Automation gets no suggestions.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isPhotoAiEnabled() || !isAiConfigured()) return fail(409, "ai_off", "AI label suggestions aren't turned on.");
  if (!(await rateLimit("photo-ai", 30, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a few minutes before asking for more suggestions.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "not_found", "Photo not found.");
  const supabase = await createClient();
  const { data: ph } = await supabase.from("project_photos").select("id, customer_id, estimate_id, thumb_path, storage_path").eq("id", id).maybeSingle();
  if (!ph) return fail(404, "not_found", "Photo not found.");
  const { data: can } = await supabase.rpc("can_upload_photos", { p_customer_id: ph.customer_id, p_estimate_id: ph.estimate_id });
  if (can !== true) return fail(403, "forbidden", "Your company role can't edit these photos.");

  const admin = createAdminClient();
  if (!(await photoAiAllowedFor(admin, { estimateId: ph.estimate_id, customerId: ph.customer_id }))) {
    return fail(409, "ai_off", "Photo label suggestions are turned off in Company → AI & Automation.");
  }
  // One guard for every paid generation (lib/ai/guard.ts): Practice/Demo, daily limit, daily/monthly budgets.
  const pre = await preflightAi(admin, user);
  if (!pre.ok) {
    if (pre.reason === "sample") return fail(409, "practice_sample", "Simulation — no real transaction. AI photo labels are off in Practice Mode. Add labels yourself.");
    if (pre.reason === "daily_limit") return fail(429, "daily_limit", "You've reached today's AI limit. Add labels yourself for now.");
    return fail(429, "ai_budget", "The AI budget is used up for now. Add labels yourself for now.");
  }
  const { data: file } = await admin.storage.from("project-photos").download(ph.thumb_path ?? ph.storage_path);
  if (!file) return fail(404, "not_found", "Photo not found.");
  const mediaType = (ph.thumb_path ?? "").endsWith(".webp") ? "image/webp" : "image/jpeg";
  try {
    const model = process.env.PHOTO_AI_MODEL?.trim() || DEFAULT_MODEL;
    const r = await generateStructured({
      model, maxTokens: 300, schema: out,
      system: "You tag construction job-site photos for a contractor's private photo library. Choose only from the allowed labels. Never describe people.",
      user: `Allowed labels: ${PHOTO_LABELS.join(", ")}. Return up to 6 that clearly apply to this photo.`,
      images: [{ data: Buffer.from(await file.arrayBuffer()).toString("base64"), mediaType }],
    });
    const labels = filterSuggestions(r.data.labels);
    await admin.rpc("photo_set_suggestions", { p_id: id, p_labels: labels, p_model: r.model });
    await admin.from("ai_generations").insert({ user_id: user.id, estimate_id: ph.estimate_id, kind: "photo_labels", engine: "ai", status: "ok", model: r.model,
      input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: Number(r.costUsd.toFixed(6)) }).then(({ error }) => { if (error) logError("photos.ai.log", error); });
    return json({ labels });
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) logError("photos.ai", e);
    return fail(502, "ai_failed", "We couldn't get suggestions right now. Add labels yourself.");
  }
}
