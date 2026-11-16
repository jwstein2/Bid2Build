"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requireAdmin } from "@/lib/admin/server";
import { blockingFlags, guardDraft, similarityFlag, type DraftFlag } from "@/lib/radar/draft";
import { radarError, createFirstDraft, importDiscussion, loadOpportunity, logFollowUp } from "@/lib/radar/server";
import { canApiPublish, defaultState, getSource, linksAllowed, SOURCE_KEYS, type SourceState } from "@/lib/radar/sources";

/**
 * Opportunity Radar owner actions. Every action: requireAdmin() first (platform admins only, 404 for
 * everyone else), validates input, writes an audit_logs row, and never contacts an external platform.
 * Publishing through a platform API is not available in this release: replies are copied and posted by
 * the owner, then confirmed here with "Mark posted".
 */
const BASE = "/admin/marketing/radar";
const uuid = z.string().uuid();
const back = (id: string, q: Record<string, string>) => `${BASE}/${id}?${new URLSearchParams(q).toString()}`;
const fail = (path: string, msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };

const Import = z.object({
  url: z.string().trim().min(10, "Paste the discussion link").max(2000),
  title: z.string().trim().min(3, "Add the discussion title").max(300),
  text: z.string().trim().max(5000).default(""),
  postedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  replyCount: z.coerce.number().int().min(0).max(100000).optional(),
  replyAllowed: z.boolean(),
});

export async function importAction(form: FormData) {
  const { user, db } = await requireAdmin();
  const p = Import.safeParse({
    url: str(form, "url"), title: str(form, "title"), text: str(form, "text"), postedAt: str(form, "posted_at"),
    replyCount: str(form, "reply_count") === "" ? undefined : str(form, "reply_count"), replyAllowed: str(form, "reply_blocked") !== "on",
  });
  if (!p.success) fail(`${BASE}#import`, p.error.issues[0]?.message ?? "Check the import fields");
  const v = p.data!;
  const r = await importDiscussion(db, user.id, { url: v.url, title: v.title, text: v.text, postedAt: v.postedAt ? `${v.postedAt}T12:00:00Z` : null, replyCount: v.replyCount ?? null, replyAllowed: v.replyAllowed });
  if (!r.ok) {
    if (r.duplicateId) redirect(back(r.duplicateId, { notice: r.error }));
    fail(`${BASE}#import`, r.error);
  }
  const id = (r as { id: string }).id;
  await audit(db, user.id, "radar.import", "radar_opportunity", id, { source: v.url.replace(/^https?:\/\//, "").split("/")[0] });
  revalidatePath(BASE);
  redirect(back(id, { notice: "Imported and scored." }));
}

export async function draftAction(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = uuid.parse(str(form, "id"));
  const { opp } = await loadOpportunity(db, id);
  if (!opp) redirect(BASE);
  const r = await createFirstDraft(db, user.id, opp!, { useAi: str(form, "engine") === "ai" });
  if (!r.ok) fail(back(id, {}), r.error);
  await audit(db, user.id, "radar.draft", "radar_opportunity", id, { engine: (r as { engine: string }).engine });
  revalidatePath(`${BASE}/${id}`);
  redirect(back(id, (r as { notice?: string }).notice ? { notice: (r as { notice: string }).notice } : {}));
}

export async function followUpAction(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = uuid.parse(str(form, "id"));
  const { opp } = await loadOpportunity(db, id);
  if (!opp) redirect(BASE);
  const parent = str(form, "parent_ref").trim();
  if (parent && !/^https:\/\/\S{5,1990}$/.test(parent) && !/^[\w:-]{1,200}$/.test(parent)) fail(back(id, {}), "The reply link must be an https:// link or a platform reply id.");
  const r = await logFollowUp(db, user.id, opp!, str(form, "follow_up").slice(0, 5000), parent || null);
  if (!r.ok) fail(back(id, {}), r.error);
  await audit(db, user.id, "radar.follow_up", "radar_opportunity", id, { reply_number: opp!.owner_replies_used + 1 });
  revalidatePath(`${BASE}/${id}`);
  redirect(back(id, (r as { notice?: string }).notice ? { notice: (r as { notice: string }).notice } : {}));
}

async function draftAndOpp(draftId: string) {
  const { user, db } = await requireAdmin();
  const { data: d } = await db.from("radar_drafts").select("*").eq("id", draftId).maybeSingle();
  if (!d) redirect(BASE);
  const { data: o } = await db.from("radar_opportunities").select("*").eq("id", d!.opportunity_id).maybeSingle();
  if (!o) redirect(BASE);
  return { user, db, d: d!, o: o! };
}

export async function editDraftAction(form: FormData) {
  const draftId = uuid.parse(str(form, "draft_id"));
  const { user, db, d, o } = await draftAndOpp(draftId);
  const body = str(form, "body").replace(/\r/g, "").trim();
  if (body.length < 10 || body.length > 5000) fail(back(o.id, {}), "The reply must be 10 to 5,000 characters.");
  const { data: st } = await db.from("radar_source_state").select("*").eq("source_key", o.source_key).maybeSingle();
  const state = (st ?? defaultState(o.source_key)) as SourceState;
  const { data: prior } = await db.from("radar_drafts").select("body").eq("opportunity_id", o.id).in("status", ["posted_manual", "published"]).order("reply_number", { ascending: false }).limit(1).maybeSingle();
  const { data: recent } = await db.from("radar_drafts").select("body,opportunity_id").in("status", ["approved", "posted_manual", "published"]).order("created_at", { ascending: false }).limit(100);
  const flags: DraftFlag[] = guardDraft(body, { mentionsProduct: /\bbuilt ?2 ?bid\b/i.test(body), linksAllowed: linksAllowed(o.source_key, state), replyNumber: d.reply_number, previous: prior?.body });
  const keepVerify = ((d.flags ?? []) as DraftFlag[]).filter((f) => f.kind === "needs_verification" || f.kind === "injection_suspected");
  const sim = similarityFlag(body, (recent ?? []).filter((r) => r.opportunity_id !== o.id).map((r) => r.body));
  if (sim.flag) flags.push(sim.flag);
  const status = d.status === "approved" ? "draft" : d.status;
  if (status !== "draft") fail(back(o.id, {}), "Only open drafts can be edited.");
  const { error } = await db.from("radar_drafts").update({ body, engine: "owner", flags: [...flags, ...keepVerify], flags_acknowledged: false, similarity_max: Math.round(sim.max * 1000) / 1000, status: "draft", approved_by: null, approved_at: null }).eq("id", draftId);
  if (error) fail(back(o.id, {}), radarError(error.message));
  await audit(db, user.id, "radar.draft_edit", "radar_draft", draftId, { reply_number: d.reply_number, chars: body.length });
  revalidatePath(`${BASE}/${o.id}`);
  redirect(back(o.id, { notice: d.status === "approved" ? "Saved. The edit moved it back to draft, so approve it again." : "Draft saved." }));
}

export async function approveAction(form: FormData) {
  const draftId = uuid.parse(str(form, "draft_id"));
  const { user, db, d, o } = await draftAndOpp(draftId);
  const flags = (d.flags ?? []) as DraftFlag[];
  const blocking = blockingFlags(flags);
  if (blocking.length) fail(back(o.id, {}), "Fix the highlighted problems in the draft before approving it.");
  if (flags.length && str(form, "ack") !== "on") fail(back(o.id, {}), "Tick the box to confirm you checked the flagged items.");
  const { error } = await db.from("radar_drafts").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString(), flags_acknowledged: flags.length > 0 }).eq("id", draftId);
  if (error) fail(back(o.id, {}), radarError(error.message));
  await audit(db, user.id, "radar.approve", "radar_draft", draftId, { reply_number: d.reply_number, flags: flags.map((f) => f.kind) });
  revalidatePath(`${BASE}/${o.id}`);
  redirect(back(o.id, { notice: "Approved. Copy it, post it yourself, then click Mark posted." }));
}

export async function markPostedAction(form: FormData) {
  const draftId = uuid.parse(str(form, "draft_id"));
  const { user, db, d, o } = await draftAndOpp(draftId);
  const url = str(form, "posted_url").trim();
  if (url && !/^https:\/\/\S{5,1990}$/.test(url)) fail(back(o.id, {}), "The posted link must start with https://");
  if (d.status !== "approved") fail(back(o.id, {}), "Approve the draft before marking it posted.");
  const { error } = await db.from("radar_drafts").update({ status: "posted_manual", posted_url: url || null, posted_at: new Date().toISOString() }).eq("id", draftId);
  if (error) fail(back(o.id, {}), radarError(error.message));
  await audit(db, user.id, "radar.posted_manual", "radar_draft", draftId, { reply_number: d.reply_number });
  revalidatePath(`${BASE}/${o.id}`);
  revalidatePath(BASE);
  redirect(back(o.id, { notice: d.reply_number >= 2 || o.reopened ? "Marked posted. The conversation is now complete." : "Marked posted. Log the person's reply here if they respond to you directly." }));
}

/** API publishing: refused unless the platform allows it, the owner authorized it, and a publisher exists (none ships yet). */
export async function publishAction(form: FormData) {
  const draftId = uuid.parse(str(form, "draft_id"));
  const { user, db, d, o } = await draftAndOpp(draftId);
  const { data: st } = await db.from("radar_source_state").select("*").eq("source_key", o.source_key).maybeSingle();
  const gate = canApiPublish(o.source_key, (st ?? undefined) as SourceState | undefined, false);
  await audit(db, user.id, "radar.publish_refused", "radar_draft", draftId, { source: o.source_key, reason: gate.ok ? "no_publisher" : "not_permitted" });
  fail(back(o.id, {}), gate.ok ? "No publisher is installed for this platform yet. Copy the reply and post it yourself." : (gate as { reason: string }).reason);
  void d;
}

export async function rejectDraftAction(form: FormData) {
  const draftId = uuid.parse(str(form, "draft_id"));
  const { user, db, d, o } = await draftAndOpp(draftId);
  const { error } = await db.from("radar_drafts").update({ status: "rejected" }).eq("id", draftId);
  if (error) fail(back(o.id, {}), radarError(error.message));
  await audit(db, user.id, "radar.draft_reject", "radar_draft", draftId, { reply_number: d.reply_number });
  revalidatePath(`${BASE}/${o.id}`);
  redirect(back(o.id, { notice: "Draft rejected." }));
}

export async function flagClaimAction(form: FormData) {
  const draftId = uuid.parse(str(form, "draft_id"));
  const { user, db, d, o } = await draftAndOpp(draftId);
  const note = str(form, "claim").trim().slice(0, 200) || "Flagged by owner";
  if (d.status !== "draft" && d.status !== "approved") fail(back(o.id, {}), "Only open drafts can be flagged.");
  const flags = [...((d.flags ?? []) as DraftFlag[]), { kind: "unsupported_claim", claim: note } as DraftFlag];
  const { error } = await db.from("radar_drafts").update({ flags, flags_acknowledged: false, ...(d.status === "approved" ? { status: "draft", approved_by: null, approved_at: null } : {}) }).eq("id", draftId);
  if (error) fail(back(o.id, {}), radarError(error.message));
  await db.from("radar_opportunities").update({ flagged_unsupported: true }).eq("id", o.id);
  await audit(db, user.id, "radar.flag_claim", "radar_draft", draftId, { claim: note });
  revalidatePath(`${BASE}/${o.id}`);
  redirect(back(o.id, { notice: "Flagged. Edit the draft to remove the claim." }));
}

const OppAction = z.enum(["reject", "archive", "restore", "close", "allow_mention", "removed"]);

export async function oppAction(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = uuid.parse(str(form, "id"));
  const action = OppAction.parse(str(form, "action"));
  const { opp: o } = await loadOpportunity(db, id);
  if (!o) redirect(BASE);
  // Close any open draft first so the opportunity's state stays consistent.
  const supersede = () => db.from("radar_drafts").update({ status: "superseded" }).eq("opportunity_id", id).in("status", ["draft", "approved", "publish_failed"]);
  let update: Record<string, unknown> = {};
  let notice = "";
  switch (action) {
    case "reject": await supersede(); update = { status: "rejected" }; notice = "Marked irrelevant."; break;
    case "archive": await supersede(); update = { status: "archived" }; notice = "Archived."; break;
    case "restore":
      if (o!.status !== "rejected" && o!.status !== "archived") fail(back(id, {}), "Only rejected or archived discussions can be restored.");
      update = { status: o!.owner_replies_used >= 2 ? "completed" : o!.owner_replies_used === 1 ? "active" : "new" }; notice = "Restored."; break;
    case "close": await supersede(); update = { status: "completed", reopened: false }; notice = "Conversation closed. No further replies will be suggested."; break;
    case "allow_mention":
      if (o!.priority !== "D") fail(back(id, {}), "Only needed for poor-fit discussions.");
      update = { allow_product_mention: true }; notice = "Product mention allowed for this discussion."; break;
    case "removed":
      await db.from("radar_drafts").update({ follow_up_text: null }).eq("opportunity_id", id);
      await supersede();
      update = { excerpt: null, title: "[Removed by the author]", content_removed_at: new Date().toISOString(), status: o!.status === "completed" ? "completed" : "archived" };
      notice = "Stored text deleted. Only the link and your own reply history are kept."; break;
  }
  const { error } = await db.from("radar_opportunities").update(update).eq("id", id);
  if (error) fail(back(id, {}), radarError(error.message));
  await audit(db, user.id, `radar.${action}`, "radar_opportunity", id, {});
  revalidatePath(BASE);
  revalidatePath(`${BASE}/${id}`);
  redirect(back(id, { notice }));
}

export async function reopenAction(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = uuid.parse(str(form, "id"));
  const reason = str(form, "reason").trim().slice(0, 500);
  const { error } = await db.rpc("radar_reopen", { p_id: id, p_reason: reason });
  if (error) fail(back(id, {}), radarError(error.message));
  await audit(db, user.id, "radar.reopen", "radar_opportunity", id, { reason });
  revalidatePath(`${BASE}/${id}`);
  redirect(back(id, { notice: "Reopened for one more reply. Log the customer's question below." }));
}

// ---------------------------------------------------------------------------------------------
// Sources and settings
// ---------------------------------------------------------------------------------------------
export async function sourceStateAction(form: FormData) {
  const { user, db } = await requireAdmin();
  const key = z.enum(SOURCE_KEYS).parse(str(form, "source_key"));
  const src = getSource(key)!;
  const links = str(form, "links");
  const want = {
    enabled: str(form, "enabled") === "on",
    links_allowed: links === "yes" ? true : links === "no" ? false : null,
    discovery_authorized: str(form, "discovery_authorized") === "on",
    publish_authorized: str(form, "publish_authorized") === "on",
  };
  // Code-level rules win: a forbidden capability can never be recorded as authorized.
  if (want.discovery_authorized && src.automatedDiscovery === "forbidden") fail(`${BASE}/sources`, `${src.platform} prohibits automated discovery. It stays manual-only.`);
  if (want.publish_authorized && src.automatedPublish === "forbidden") fail(`${BASE}/sources`, `${src.platform} prohibits automated publishing. It stays manual-only.`);
  const { error } = await db.from("radar_source_state").upsert({ source_key: key, ...want, updated_by: user.id }, { onConflict: "source_key" });
  if (error) fail(`${BASE}/sources`, "Could not save. Is the Opportunity Radar migration installed?");
  await audit(db, user.id, "radar.source_state", "radar_source", key, want);
  revalidatePath(`${BASE}/sources`);
  redirect(`${BASE}/sources?saved=${key}#${key}`);
}

const Settings = z.object({
  monthly_budget_usd: z.coerce.number().min(0).max(1000),
  max_imports_per_day: z.coerce.number().int().min(1).max(500),
  retention_days: z.coerce.number().int().min(7).max(730),
  ai_drafting_enabled: z.boolean(),
});

export async function settingsAction(form: FormData) {
  const { user, db } = await requireAdmin();
  const p = Settings.safeParse({ monthly_budget_usd: str(form, "budget"), max_imports_per_day: str(form, "max_imports"), retention_days: str(form, "retention"), ai_drafting_enabled: str(form, "ai") === "on" });
  if (!p.success) fail(`${BASE}#costs`, p.error.issues[0]?.message ?? "Check the settings");
  const { error } = await db.from("radar_settings").upsert({ id: true, ...p.data!, updated_by: user.id }, { onConflict: "id" });
  if (error) fail(`${BASE}#costs`, "Could not save settings.");
  await audit(db, user.id, "radar.settings", "radar_settings", "1", p.data!);
  revalidatePath(BASE);
  redirect(`${BASE}?notice=${encodeURIComponent("Settings saved.")}#costs`);
}

export async function purgeAction() {
  const { user, db } = await requireAdmin();
  const { data, error } = await db.rpc("radar_purge_content", { p_days: null });
  if (error) fail(`${BASE}#costs`, "Purge failed.");
  await audit(db, user.id, "radar.purge", "radar_settings", "1", { cleared: data });
  revalidatePath(BASE);
  redirect(`${BASE}?notice=${encodeURIComponent(`Cleared stored text from ${data ?? 0} old record(s).`)}#costs`);
}
