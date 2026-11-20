import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { approvalPreview, approveRequestSchema, canonicalUnit, findDuplicate, itemPatchSchema, stackPatchSchema, type ItemPatch } from "@/lib/library-generator/model";
import { loadDetail, loadSavedItems, mapItem, type Supa } from "@/lib/library-generator/server";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */
const uuid = z.string().uuid();

const patchSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("draft"), status: z.enum(["draft", "under_review", "archived"]).optional(), title: z.string().trim().min(1).max(160).optional() }),
  z.strictObject({ op: z.literal("items"), ids: z.array(uuid).min(1).max(1000), patch: itemPatchSchema }),
  z.strictObject({ op: z.literal("stack"), id: uuid, patch: stackPatchSchema }),
]);
const postSchema = z.discriminatedUnion("op", [
  approveRequestSchema.extend({ op: z.literal("preview") }),
  approveRequestSchema.extend({ op: z.literal("approve") }),
]);

/** Fields a bulk edit may change (same value for every selected item). */
const BULK_KEYS = new Set<keyof ItemPatch>(["category", "costType", "duplicateAction", "removed", "taxable", "trade"]);

const MESSAGES: Record<string, [number, string]> = {
  unresolved_duplicates: [409, "Choose what to do with each possible duplicate before approving."],
  draft_not_ready: [409, "This draft isn't ready to approve yet."],
  draft_not_found: [404, "That draft no longer exists."],
  premium_required: [402, "Saved Stacks are part of Individual Unlimited. Your items can still be approved."],
  company_template_locked: [403, "Only people who manage company pricing can save company templates."],
  free_item_limit: [402, "Free accounts can keep up to 250 saved items. Approve fewer items, or upgrade to Individual Unlimited for no limit."],
  stack_empty: [409, "A stack has no rows left. Add rows or remove the stack."],
  approval_required: [409, "Approve items with the Approve button."],
  already_approved: [409, "That item is already in your Saved Items."],
};
const known = (msg: string) => Object.keys(MESSAGES).find((k) => msg.includes(k));

async function matchesFor(supabase: Supa, ids: string[]) {
  if (!ids.length) return [];
  const { data } = await supabase.from("saved_items").select("id, name, unit, unit_cost, price_source, supplier_name, category").in("id", ids);
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, unit: r.unit, unitCost: r.unit_cost === null ? "" : String(Number(r.unit_cost)), priceSource: r.price_source ?? null, supplierName: r.supplier_name ?? null, category: r.category ?? null }));
}

async function detailResponse(supabase: Supa, id: string) {
  const detail = await loadDetail(supabase, id);
  if (!detail) return fail(404, "not_found", "That draft no longer exists.");
  const matches = await matchesFor(supabase, [...new Set(detail.items.flatMap((i) => (i.duplicateOf ? [i.duplicateOf] : [])))]);
  const [premium, companyId] = await Promise.all([hasPremiumAccess(supabase), supabase.rpc("my_company_id").then((r) => r.data as string | null)]);
  const canShare = companyId ? (await supabase.rpc("has_company_permission", { p_company_id: companyId, p_permission: "manage_company_pricing" })).data === true : false;
  return json({ ...detail, matches, stacksAccess: premium, canShare });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "That draft no longer exists.");
  return detailResponse(await createClient(), id);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "That draft no longer exists.");
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Check the highlighted fields.", { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) });
  const supabase = await createClient();
  const { data: draft } = await supabase.from("library_drafts").select("id, status").eq("id", id).maybeSingle();
  if (!draft) return fail(404, "not_found", "That draft no longer exists.");
  const o = parsed.data;

  if (o.op === "draft") {
    if (draft.status === "generating" && o.status) return fail(409, "busy", "This draft is still generating.");
    const row: Record<string, unknown> = {};
    if (o.title) row.title = o.title;
    if (o.status) row.status = o.status === "draft" && draft.status === "archived" ? "draft" : o.status;
    const { error } = await supabase.from("library_drafts").update(row).eq("id", id);
    if (error) return fail(500, "save_failed", "Could not save your draft. Please try again.");
    return json({ ok: true });
  }

  if (draft.status === "archived") return fail(409, "archived", "Restore this draft to edit it.");

  if (o.op === "items") {
    const p = o.patch;
    const keys = Object.keys(p) as (keyof ItemPatch)[];
    if (o.ids.length > 1 && keys.some((k) => !BULK_KEYS.has(k))) return fail(400, "invalid", "Edit names, units and costs one item at a time.");
    const { data: rows } = await supabase.from("library_draft_items").select("*").eq("draft_id", id).in("id", o.ids);
    if (!rows?.length) return fail(404, "not_found", "Those items are no longer in this draft.");
    const needsDupCheck = p.name !== undefined || p.unit !== undefined || p.trade !== undefined || p.supplierSku !== undefined || p.costType !== undefined;
    const saved = needsDupCheck ? await loadSavedItems(supabase) : [];
    for (const r of rows) {
      const cur = mapItem(r);
      if (cur.status !== "candidate" && cur.status !== "removed") return fail(409, "already_approved", "That item is already in your Saved Items.");
      const row: Record<string, unknown> = {};
      if (p.name !== undefined) row.name = p.name;
      if (p.description !== undefined) row.description = p.description.trim() || null;
      if (p.trade !== undefined) row.trade = p.trade;
      if (p.category !== undefined) row.category = p.category;
      if (p.costType !== undefined) row.cost_type = p.costType;
      if (p.unit !== undefined) row.unit = canonicalUnit(p.unit);
      if (p.supplierSku !== undefined) row.supplier_sku = p.supplierSku || null;
      if (p.notes !== undefined) row.notes = p.notes.trim() || null;
      if (p.taxable !== undefined) row.taxable = p.taxable;
      if (p.removed !== undefined) row.status = p.removed ? "removed" : "candidate";
      if (p.duplicateAction !== undefined) row.duplicate_action = cur.duplicateOf ? p.duplicateAction : null;
      if (p.unitCost !== undefined && p.unitCost.trim() !== cur.unitCost) {
        row.unit_cost = p.unitCost.trim() === "" ? null : p.unitCost.trim();
        row.cost_source = p.unitCost.trim() === "" ? "none" : "contractor";
        row.cost_source_note = null;
      }
      if (p.costAction === "accept_suggestion" && cur.suggestedCost) {
        row.unit_cost = cur.suggestedCost; row.cost_source = "history"; row.cost_source_note = cur.suggestedNote || "From your past estimates";
      } else if (p.costAction === "clear") {
        row.unit_cost = null; row.cost_source = "none"; row.cost_source_note = null;
      }
      // A unit change makes an attributed price unsafe: it was for the old unit.
      if (row.unit !== undefined && row.unit !== cur.unit && row.unit_cost === undefined && cur.costSource !== "contractor" && cur.costSource !== "none") {
        row.unit_cost = null; row.cost_source = "none"; row.cost_source_note = null;
      }
      if (needsDupCheck) {
        const next = { name: (row.name as string) ?? cur.name, unit: (row.unit as string) ?? cur.unit, trade: row.trade !== undefined ? (row.trade as string | null) : cur.trade, costType: (row.cost_type as any) ?? cur.costType, supplierSku: (row.supplier_sku as string) ?? cur.supplierSku };
        const dup = findDuplicate(next, saved);
        if ((dup?.savedItemId ?? null) !== cur.duplicateOf) {
          row.duplicate_of = dup?.savedItemId ?? null;
          row.duplicate_level = dup?.level ?? null;
          row.duplicate_reason = dup?.reason ?? null;
          row.duplicate_action = dup?.level === "exact" ? "keep_existing" : null;
        }
      }
      if (!Object.keys(row).length) continue;
      if (o.ids.length > 1) break; // bulk: one update below
      const { error } = await supabase.from("library_draft_items").update(row).eq("id", cur.id).eq("draft_id", id);
      if (error) return fail(error.message.includes("already_approved") ? 409 : 500, "save_failed", error.message.includes("already_approved") ? "That item is already in your Saved Items." : "Could not save that change. Please try again.");
    }
    if (o.ids.length > 1) {
      const row: Record<string, unknown> = {};
      if (p.category !== undefined) row.category = p.category;
      if (p.costType !== undefined) row.cost_type = p.costType;
      if (p.taxable !== undefined) row.taxable = p.taxable;
      if (p.trade !== undefined) row.trade = p.trade;
      if (p.removed !== undefined) row.status = p.removed ? "removed" : "candidate";
      const ids = rows.filter((r: any) => r.status === "candidate" || r.status === "removed").map((r: any) => r.id);
      if (Object.keys(row).length && ids.length) {
        const { error } = await supabase.from("library_draft_items").update(row).in("id", ids).eq("draft_id", id);
        if (error) return fail(500, "save_failed", "Could not save that change. Please try again.");
      }
      if (p.duplicateAction !== undefined) {
        const dupIds = rows.filter((r: any) => r.status === "candidate" && r.duplicate_of).map((r: any) => r.id);
        if (dupIds.length) await supabase.from("library_draft_items").update({ duplicate_action: p.duplicateAction }).in("id", dupIds).eq("draft_id", id);
      }
    }
    if (draft.status === "draft") await supabase.from("library_drafts").update({ status: "under_review" }).eq("id", id).eq("status", "draft");
    const { data: fresh } = await supabase.from("library_draft_items").select("*").in("id", o.ids);
    return json({ items: (fresh ?? []).map(mapItem) });
  }

  // Stack edits (formulas are reviewed here; nothing is saved to Saved Stacks until approved).
  const { data: st } = await supabase.from("library_draft_stacks").select("id, status").eq("id", o.id).eq("draft_id", id).maybeSingle();
  if (!st) return fail(404, "not_found", "That stack is no longer in this draft.");
  if (st.status === "approved") return fail(409, "already_approved", "That stack is already in your Saved Stacks.");
  const p = o.patch;
  const row: Record<string, unknown> = {};
  if (p.name !== undefined) row.name = p.name;
  if (p.scaleUnit !== undefined) row.scale_unit = p.scaleUnit;
  if (p.scaleLabel !== undefined) row.scale_label = p.scaleLabel || null;
  if (p.removed !== undefined) row.status = p.removed ? "removed" : "candidate";
  if (p.components !== undefined) {
    const { data: own } = await supabase.from("library_draft_items").select("id").eq("draft_id", id).in("id", p.components.map((c) => c.itemId));
    const ok = new Set((own ?? []).map((r: any) => r.id));
    row.components = p.components.filter((c) => ok.has(c.itemId));
  }
  const { error } = await supabase.from("library_draft_stacks").update(row).eq("id", o.id).eq("draft_id", id);
  if (error) return fail(500, "save_failed", "Could not save that stack. Please try again.");
  if (draft.status === "draft") await supabase.from("library_drafts").update({ status: "under_review" }).eq("id", id).eq("status", "draft");
  return json({ ok: true });
}

/** preview: what approving would do. approve: do it (one database transaction, idempotent per requestKey). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "That draft no longer exists.");
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Pick the items to approve.");
  const supabase = await createClient();
  const o = parsed.data;

  if (o.op === "preview") {
    const detail = await loadDetail(supabase, id);
    if (!detail) return fail(404, "not_found", "That draft no longer exists.");
    const saved = await loadSavedItems(supabase);
    const stackIds = o.stackIds.filter((s) => detail.stacks.some((x) => x.id === s && x.status === "candidate"));
    return json(approvalPreview(detail.items, o.itemIds, { templates: o.templates, stackIds, savedItems: saved }));
  }

  if (o.stackIds.length && !(await hasPremiumAccess(supabase))) return fail(402, "premium_required", MESSAGES.premium_required[1]);
  const { data, error } = await supabase.rpc("library_draft_approve", {
    p: { draftId: id, requestKey: o.requestKey, itemIds: o.itemIds, stackIds: o.stackIds, templates: o.templates, shareStacks: o.shareStacks },
  });
  if (error) {
    const k = known(error.message);
    if (k) return fail(MESSAGES[k][0], k, MESSAGES[k][1]);
    return fail(500, "approve_failed", "Nothing was saved. Please try again.");
  }
  return json({ result: data });
}
