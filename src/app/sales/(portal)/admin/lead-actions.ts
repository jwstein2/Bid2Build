"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesAdmin } from "@/lib/sales/server";
import type { SalesCap } from "@/lib/sales/caps";
import { parseLeadRows } from "@/lib/sales/crm";
import { ADMIN_LEAD_ERRORS, csvToRows } from "@/lib/sales/leads-admin";
import { markEmailBounced, recheckLeadEmails } from "@/lib/sales/email-check";

/**
 * V8.6 admin lead actions. Each re-checks the caller here and again in the database (admin_sales_*),
 * which also writes the assignment history and audit log in the same transaction.
 */

const PENDING = "sales_assign_pending";
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const code = (e: { message?: string } | null) => Object.keys(ADMIN_LEAD_ERRORS).find((k) => (e?.message ?? "").includes(k)) ?? "invalid";

/** Back to the leads tab with the same filters (or to a lead's page). */
function backTo(fd: FormData | null, result: { ok?: string; err?: string }, extra: Record<string, string> = {}): never {
  const raw = String(fd?.get("back") ?? "tab=leads");
  const lead = /^lead:([0-9a-f-]{36})$/i.exec(raw)?.[1];
  const base = lead ? `/sales/admin/leads/${lead}` : "/sales/admin";
  const q = new URLSearchParams(lead ? {} : Object.fromEntries(new URLSearchParams(raw.startsWith("tab=leads") ? raw : "tab=leads")));
  q.delete("ok"); q.delete("err"); q.delete("confirm");
  if (result.ok) q.set("ok", result.ok);
  if (result.err) q.set("err", ADMIN_LEAD_ERRORS[result.err] ? result.err : "invalid");
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  revalidatePath("/sales/admin");
  if (lead) revalidatePath(base);
  redirect(`${base}?${q.toString()}`);
}

async function need(cap: SalesCap, fd: FormData | null) {
  const a = await requireSalesAdmin();
  if (!a.has(cap)) backTo(fd, { err: "not_authorized" });
  return a;
}

const ids = (fd: FormData) => [...new Set(fd.getAll("lead").map(String).filter((x) => uuidRe.test(x)))].slice(0, 500);

/** Paste or CSV upload. Mode: auto (round robin), rep (one rep), hold (queue). */
export async function importLeadsV86(fd: FormData) {
  const { user, db } = await need("reassign_leads", fd);
  const mode = ["auto", "rep", "hold"].includes(String(fd.get("mode"))) ? String(fd.get("mode")) : "auto";
  const rep = String(fd.get("rep") ?? "");
  const file = fd.get("file");
  let text = String(fd.get("rows") ?? "").slice(0, 500_000);
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) backTo(fd, { err: "invalid_rows" });
    text = (await file.text()).slice(0, 2_000_000);
  }
  const rows = csvToRows(text).length ? csvToRows(text) : parseLeadRows(text, 1000);
  if (rows.length === 0) backTo(fd, { err: "invalid_rows" });
  if (mode === "rep" && !uuidRe.test(rep)) backTo(fd, { err: "rep_not_found" });
  const { data, error } = await db.rpc("admin_sales_lead_import", { p_caller: user.id, p_rows: rows, p_mode: mode, p_rep: mode === "rep" ? rep : null, p_label: String(fd.get("label") ?? "").slice(0, 200) || null });
  if (error) backTo(fd, { err: code(error) });
  const r = data as { added: number; duplicates: number; possible: number; suppressed: number; invalid: number; existing_customers: number; allocated: number; held: number };
  // Check the new leads' emails can receive mail (DNS only, within the request; the daily job finishes any left).
  const mail = r.added ? await recheckLeadEmails(db, { limit: Math.min(r.added, 300) }).catch(() => null) : null;
  const parts = [`Added ${r.added}`, r.allocated ? `${r.allocated} assigned` : "", r.held ? `${r.held} waiting in the queue` : "", r.duplicates ? `${r.duplicates} already on file (left with their owner)` : "",
    r.possible ? `${r.possible} possible duplicates to review` : "", r.existing_customers ? `${r.existing_customers} existing customers held for review` : "",
    r.suppressed ? `${r.suppressed} on the do-not-contact list` : "", r.invalid ? `${r.invalid} missing a name or contact` : "",
    mail?.bad ? `${mail.bad} with an email that can't receive mail (flagged on the lead)` : ""].filter(Boolean);
  backTo(fd, { ok: parts.join(", ") + "." });
}

async function runAssign(fd: FormData, leads: string[], mode: string, rep: string | null, reason: string | null, confirmed: boolean) {
  const { user, db } = await need("reassign_leads", fd);
  if (leads.length === 0) backTo(fd, { err: "invalid" });
  const { data, error } = await db.rpc("admin_sales_leads_assign", { p_caller: user.id, p_leads: leads, p_mode: mode, p_rep: rep, p_reason: reason, p_confirmed: confirmed });
  if (error) backTo(fd, { err: code(error) });
  const r = data as { needs_confirm?: boolean; warnings?: unknown[]; changed?: number };
  if (r.needs_confirm) {
    (await cookies()).set(PENDING, JSON.stringify({ leads, mode, rep, reason, back: String(fd.get("back") ?? "tab=leads"), warnings: r.warnings }), {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/sales/admin", maxAge: 600,
    });
    backTo(fd, {}, { confirm: "1" });
  }
  const n = r.changed ?? 0;
  backTo(fd, { ok: mode === "auto" ? `${n} lead${n === 1 ? "" : "s"} shared out by round robin.` : mode === "unassign" ? `${n} returned to the queue.` : `${n} lead${n === 1 ? "" : "s"} assigned.` });
}

/** Bulk bar and row forms. The submit button's value picks the mode. */
export async function assignLeadsV86(fd: FormData) {
  const mode = ["rep", "self", "unassign", "auto"].includes(String(fd.get("mode"))) ? String(fd.get("mode")) : "rep";
  const rep = String(fd.get("rep") ?? "");
  if (mode === "rep" && !uuidRe.test(rep)) backTo(fd, { err: "rep_not_found" });
  await runAssign(fd, ids(fd), mode, mode === "rep" ? rep : null, String(fd.get("reason") ?? "").trim().slice(0, 300) || null, false);
}

export async function confirmAssign(fd: FormData) {
  const jar = await cookies();
  const raw = jar.get(PENDING)?.value;
  jar.delete({ name: PENDING, path: "/sales/admin" });
  const p = z.object({ leads: z.array(z.string().regex(uuidRe)).min(1).max(500), mode: z.enum(["rep", "self", "unassign", "auto"]), rep: z.string().regex(uuidRe).nullable(), reason: z.string().max(300).nullable(), back: z.string().max(2000) })
    .safeParse(raw ? JSON.parse(raw) : null);
  if (!p.success) backTo(fd, { err: "invalid" });
  fd.set("back", p.data.back);
  await runAssign(fd, p.data.leads, p.data.mode, p.data.rep, p.data.reason, true);
}

export async function cancelAssign(fd: FormData) {
  (await cookies()).delete({ name: PENDING, path: "/sales/admin" });
  backTo(fd, { ok: "Nothing changed." });
}

export async function holdLeads(fd: FormData) {
  const { user, db } = await need("reassign_leads", fd);
  const reason = String(fd.get("hold") ?? "");
  const { data, error } = await db.rpc("admin_sales_leads_hold", { p_caller: user.id, p_leads: ids(fd), p_reason: reason === "release" ? null : reason, p_note: String(fd.get("note") ?? "").slice(0, 300) || null });
  if (error) backTo(fd, { err: code(error) });
  backTo(fd, { ok: reason === "release" ? `${data} released for allocation.` : `${data} on hold. Only unassigned leads can be held.` });
}

export async function allocateQueue(fd: FormData) {
  const { user, db } = await need("reassign_leads", fd);
  const { data, error } = await db.rpc("admin_sales_allocate_queue", { p_caller: user.id });
  if (error) backTo(fd, { err: code(error) });
  const r = data as { allocated: number; still_waiting: number };
  backTo(fd, { ok: `${r.allocated} shared out.${r.still_waiting ? ` ${r.still_waiting} still have no eligible rep (check paused reps, territories and time off).` : ""}` });
}

export async function decideDuplicate(fd: FormData) {
  const { user, db } = await need("reassign_leads", fd);
  const row = Number(fd.get("row"));
  const decision = String(fd.get("decision"));
  const target = String(fd.get("target") ?? "");
  if (!Number.isInteger(row) || !["merge", "skip", "create"].includes(decision)) backTo(fd, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_possible_dup_decide", { p_caller: user.id, p_row: row, p_decision: decision, p_target: uuidRe.test(target) ? target : null });
  if (error) backTo(fd, { err: code(error) });
  backTo(fd, { ok: decision === "merge" ? "Merged into the existing lead. Its owner and history are unchanged." : decision === "create" ? "Added as a separate business." : "Skipped." });
}

/** An admin works a lead directly. Recorded once, as the admin; the owner sees it too. */
export async function adminLogActivity(fd: FormData) {
  const { user, db } = await need("view_all_leads", fd);
  const lead = z.string().regex(uuidRe).safeParse(fd.get("lead"));
  const p = z.object({ kind: z.enum(["call", "email", "text", "meeting", "note", "reply"]), body: z.string().trim().min(1).max(4000), disposition: z.string().max(40).optional() }).safeParse(Object.fromEntries(fd));
  if (!lead.success || !p.success) backTo(fd, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_lead_activity_add", { p_caller: user.id, p_lead: lead.data, p_kind: p.data.kind, p_body: p.data.body, p_disposition: p.data.disposition || null });
  if (error) backTo(fd, { err: code(error) });
  if (p.data.kind === "email" && p.data.disposition === "bounced") await markEmailBounced(db, lead.data, p.data.body, user.id).catch(() => false);
  backTo(fd, { ok: "Logged on the lead. The owner sees it in their CRM." });
}

export async function adminScheduleFollowUp(fd: FormData) {
  const { user, db } = await need("view_all_leads", fd);
  const lead = z.string().regex(uuidRe).safeParse(fd.get("lead"));
  const title = String(fd.get("title") ?? "").trim().slice(0, 200);
  const due = String(fd.get("due") ?? "");
  if (!lead.success || !title || !/^\d{4}-\d{2}-\d{2}$/.test(due)) backTo(fd, { err: "invalid" });
  const { error } = await db.rpc("admin_sales_lead_task", { p_caller: user.id, p_lead: lead.data, p_title: title, p_due_at: new Date(`${due}T15:00:00Z`).toISOString() });
  if (error) backTo(fd, { err: code(error) });
  backTo(fd, { ok: "Follow-up scheduled for the lead's owner." });
}

/** A real bounce came back for this lead's email: mark it bad and put it on the known-bounce list. */
export async function adminMarkEmailBounced(fd: FormData) {
  const { user, db } = await need("view_all_leads", fd);
  const lead = z.string().regex(uuidRe).safeParse(fd.get("lead"));
  if (!lead.success) backTo(fd, { err: "invalid" });
  const ok = await markEmailBounced(db, lead.data, String(fd.get("note") ?? ""), user.id);
  backTo(fd, ok ? { ok: "Email marked as bounced. Reach them by phone." } : { err: "invalid" });
}

/** Re-run the mail-server check on every lead's email (DNS only, nothing is sent). */
export async function recheckAllLeadEmails(fd: FormData) {
  const { db } = await need("reassign_leads", fd);
  const r = await recheckLeadEmails(db, { all: true, limit: 1000 });
  if ("error" in r && r.error) backTo(fd, { err: "invalid" });
  backTo(fd, { ok: `Checked ${r.checked} email${r.checked === 1 ? "" : "s"}: ${r.ok} can receive mail, ${r.bad} can't${r.unknown ? `, ${r.unknown} couldn't be checked right now (try again later)` : ""}.` });
}
