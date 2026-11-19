"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSalesAdmin } from "@/lib/sales/server";
import type { SalesCap } from "@/lib/sales/caps";
import { ADMIN_LEAD_ERRORS } from "@/lib/sales/leads-admin";

/**
 * V8.7 lead recycling admin actions. Every call is re-checked in the database (admin_sales_recycle_*)
 * and audited there. Nothing here changes commission or attribution.
 */

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const code = (e: { message?: string } | null) => Object.keys(ADMIN_LEAD_ERRORS).find((k) => (e?.message ?? "").includes(k)) ?? "invalid";

/** Back to the recycling tab (keeping filters) or to a lead's page ("lead:<id>"). */
function back(fd: FormData, result: { ok?: string; err?: string }): never {
  const raw = String(fd.get("back") ?? "");
  const lead = /^lead:([0-9a-f-]{36})$/i.exec(raw)?.[1];
  const q = new URLSearchParams(lead ? {} : Object.fromEntries(new URLSearchParams(raw.startsWith("tab=recycling") ? raw : "tab=recycling")));
  q.delete("ok"); q.delete("err");
  if (result.ok) q.set("ok", result.ok);
  if (result.err) q.set("err", ADMIN_LEAD_ERRORS[result.err] ? result.err : "invalid");
  revalidatePath("/sales/admin");
  if (lead) revalidatePath(`/sales/admin/leads/${lead}`);
  redirect(lead ? `/sales/admin/leads/${lead}?${q}` : `/sales/admin?${q}`);
}

async function need(cap: SalesCap, fd: FormData) {
  const a = await requireSalesAdmin();
  if (!a.has(cap)) back(fd, { err: "not_authorized" });
  return a;
}

const leadIds = (fd: FormData) => [...new Set(fd.getAll("lead").map(String).filter((x) => uuidRe.test(x)))].slice(0, 500);
const num = (v: FormDataEntryValue | null, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : undefined; };

export async function saveRecycleSettings(fd: FormData) {
  const { user, db } = await need("manage_reps", fd);
  const p = {
    enabled: fd.get("enabled") === "on",
    days: num(fd.get("days"), 3, 30), grace: num(fd.get("grace"), 1, 14), warning_hours: num(fd.get("warning_hours"), 12, 72), max_cycles: num(fd.get("max_cycles"), 2, 10),
  };
  const { error } = await db.rpc("admin_sales_recycle_settings", { p_caller: user.id, p });
  if (error) back(fd, { err: code(error) });
  back(fd, { ok: p.enabled ? "Recycling settings saved." : "Recycling paused. Nothing will be warned or moved until you turn it back on." });
}

export async function extendDeadline(fd: FormData) {
  const { user, db } = await need("reassign_leads", fd);
  const leads = leadIds(fd);
  const days = num(fd.get("days"), 1, 30);
  if (!leads.length || !days) back(fd, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_recycle_extend", { p_caller: user.id, p_leads: leads, p_days: days, p_reason: String(fd.get("reason") ?? "").slice(0, 200) || null });
  if (error) back(fd, { err: code(error) });
  back(fd, { ok: `Deadline extended ${days} day${days === 1 ? "" : "s"}. The rep gets a fresh warning before anything moves.` });
}

export async function holdFromRecycling(fd: FormData) {
  const { user, db } = await need("reassign_leads", fd);
  const leads = leadIds(fd);
  const release = fd.get("release") === "1";
  const until = String(fd.get("until") ?? "");
  if (!leads.length || (!release && !/^\d{4}-\d{2}-\d{2}$/.test(until))) back(fd, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_recycle_hold", {
    p_caller: user.id, p_leads: leads, p_until: release ? null : new Date(`${until}T23:59:00-06:00`).toISOString(), p_note: String(fd.get("note") ?? "").slice(0, 300) || null,
  });
  if (error) back(fd, { err: code(error) });
  back(fd, { ok: release ? "Recycling hold removed." : "Held from recycling until that date." });
}

export async function recycleNow(fd: FormData) {
  const { user, db } = await need("reassign_leads", fd);
  const leads = leadIds(fd);
  if (!leads.length || fd.get("confirm") !== "on") back(fd, { err: "invalid" });
  const { data, error } = await db.rpc("admin_sales_recycle_now", { p_caller: user.id, p_leads: leads, p_note: String(fd.get("note") ?? "").slice(0, 300) || null });
  if (error) back(fd, { err: code(error) });
  const r = data as { recycled: number; reassigned: number };
  back(fd, { ok: `${r.recycled} lead${r.recycled === 1 ? "" : "s"} recycled, ${r.reassigned} reassigned. History and commission didn't change.` });
}

export async function reviewRecycled(fd: FormData) {
  const { user, db } = await need("reassign_leads", fd);
  const lead = String(fd.get("lead") ?? "");
  const decision = fd.get("decision") === "dormant" ? "dormant" : "reassign";
  const rep = String(fd.get("rep") ?? "");
  if (!uuidRe.test(lead)) back(fd, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_recycle_review", { p_caller: user.id, p_lead: lead, p_decision: decision, p_rep: uuidRe.test(rep) ? rep : null });
  if (error) back(fd, { err: code(error) });
  back(fd, { ok: decision === "dormant" ? "Parked as dormant. It won't be shared out until you assign it." : "Lead reassigned with a fresh window." });
}

export async function decideDispute(fd: FormData) {
  const { user, db } = await need("reassign_leads", fd);
  const id = String(fd.get("id") ?? "");
  const decision = fd.get("decision") === "upheld" ? "upheld" : "rejected";
  if (!uuidRe.test(id)) back(fd, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_recycle_dispute_decide", { p_caller: user.id, p_id: id, p_decision: decision, p_note: String(fd.get("note") ?? "").slice(0, 300) || null });
  if (error) back(fd, { err: code(error) });
  back(fd, { ok: decision === "upheld" ? "Review accepted. The lead has a fresh window." : "Review declined. The normal timeline applies." });
}
