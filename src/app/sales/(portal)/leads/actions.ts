"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesRep } from "@/lib/sales/server";
import { parseLeadRows, STAGES, TRADES } from "@/lib/sales/crm";
import { csvToRows, DISPOSITIONS } from "@/lib/sales/leads-admin";
import { activityErrorMessage } from "@/lib/sales/calling";

/**
 * Rep CRM actions. Every call runs with the rep's own session through sales_crm_* functions, which
 * only touch leads the rep may see (their own; managers see all).
 */
const t = (max: number) => z.string().trim().max(max);
function back(path: string, q: Record<string, string>): never {
  revalidatePath("/sales/leads");
  redirect(`${path}?${new URLSearchParams(q)}`);
}

export async function createLead(fd: FormData) {
  const { db } = await requireSalesRep();
  const p = z.object({
    company_name: t(200).min(1), contact_name: t(120), email: z.string().trim().toLowerCase().email().max(320).or(z.literal("")), phone: t(40), website: t(300),
    city: t(100), state: t(40), zip: z.string().trim().regex(/^\d{5}$/).or(z.literal("")), notes: t(4000), allow_duplicate: z.string().optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) back("/sales/leads", { err: "Check the form: company name is required, ZIP is 5 digits." });
  const trades = fd.getAll("trades").map(String).filter((x) => (TRADES as readonly string[]).includes(x));
  const { data, error } = await db.rpc("sales_crm_lead_create", { p: { ...p.data, trades, allow_duplicate: p.data.allow_duplicate === "on" } });
  if (error) back("/sales/leads", { err: "That lead couldn't be saved. Try again." });
  const r = data as { ok: boolean; error?: string; duplicates?: { company_name: string; rep_name: string | null }[]; lead?: { id: string } };
  if (!r.ok) {
    const who = r.duplicates?.map((d) => `${d.company_name}${d.rep_name ? ` (${d.rep_name})` : " (unassigned)"}`).join(", ");
    back("/sales/leads", { err: r.error === "owned_by_other" ? `Already being worked by another rep: ${who}. Ask the owner if it should move to you.` : `Possible duplicate: ${who}. Tick "It's a different business" to add it anyway.` });
  }
  redirect(`/sales/leads/${r.lead!.id}`);
}

export async function updateLead(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().parse(fd.get("id"));
  const p = z.object({
    stage: z.enum(STAGES), lost_reason: t(300), contact_name: t(120), email: z.string().trim().toLowerCase().email().or(z.literal("")), phone: t(40),
    website: t(300), city: t(100), state: t(40), zip: z.string().trim().regex(/^\d{5}$/).or(z.literal("")), notes: t(4000), do_not_contact: z.string().optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) back(`/sales/leads/${id}`, { err: "Check the form and try again." });
  const { error } = await db.rpc("sales_crm_lead_update", { p_id: id, p: { ...p.data, do_not_contact: p.data.do_not_contact === "on" } });
  if (error) back(`/sales/leads/${id}`, { err: "That change couldn't be saved." });
  back(`/sales/leads/${id}`, { ok: "Saved." });
}

export async function logActivity(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().parse(fd.get("id"));
  const p = z.object({ kind: z.enum(["call", "email", "text", "meeting", "note", "reply"]), body: t(4000).min(1), disposition: t(40).optional() }).safeParse(Object.fromEntries(fd));
  if (!p.success) back(`/sales/leads/${id}`, { err: "Write a short note about what happened." });
  const disposition = p.data.disposition && DISPOSITIONS[p.data.kind]?.some((d) => d.v === p.data.disposition) ? p.data.disposition : null;
  const { error } = await db.rpc("sales_crm_activity_log", { p_lead: id, p_kind: p.data.kind, p_body: p.data.body, p_disposition: disposition });
  if (error) back(`/sales/leads/${id}`, { err: activityErrorMessage(error.message) });
  back(`/sales/leads/${id}`, { ok: "Logged." });
}

export async function saveTask(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().parse(fd.get("id"));
  const task = z.string().uuid().or(z.literal("")).parse(fd.get("task") ?? "");
  const title = String(fd.get("title") ?? "").trim().slice(0, 200);
  const due = String(fd.get("due") ?? "");
  const done = fd.get("done") === "1";
  if (!task && (!title || !/^\d{4}-\d{2}-\d{2}$/.test(due))) back(`/sales/leads/${id}`, { err: "A task needs a title and a due date." });
  const dueAt = due ? new Date(`${due}T15:00:00Z`).toISOString() : null; // mid-morning Central
  const { error } = await db.rpc("sales_crm_task_save", { p_lead: id, p_task: task || null, p_title: title || null, p_due_at: dueAt, p_done: done });
  if (error) back(`/sales/leads/${id}`, { err: "That task couldn't be saved." });
  back(`/sales/leads/${id}`, { ok: done ? "Task done." : "Task saved." });
}

/** Record a National Do Not Call Registry check (and the line type, and text consent if given). */
export async function recordDncCheck(fd: FormData) {
  const { db } = await requireSalesRep();
  const id = z.string().uuid().parse(fd.get("id"));
  const p = z.object({ dnc: z.enum(["clear", "listed"]), line: z.enum(["unknown", "landline", "mobile", "voip"]), text_consent: z.string().optional(), consent_note: t(300).optional(), confirm: z.literal("on") }).safeParse(Object.fromEntries(fd));
  if (!p.success) back(`/sales/leads/${id}`, { err: "Choose the registry result and tick the box to confirm you checked it." });
  const { error } = await db.rpc("sales_crm_dnc_record", { p_lead: id, p_status: p.data.dnc, p_line: p.data.line, p_text_consent: p.data.text_consent === "on", p_consent_note: p.data.consent_note ?? null });
  if (error) back(`/sales/leads/${id}`, { err: "That check couldn't be saved. If this keeps happening, the database update may not be installed yet." });
  back(`/sales/leads/${id}`, { ok: p.data.dnc === "listed" ? "Recorded. This number is on the registry: no calls or texts." : "Recorded." });
}

/** A rep imports their own list (CSV or pasted rows). Their new leads stay theirs; anything already on file stays with its owner. */
export async function importMyLeads(fd: FormData) {
  const { db } = await requireSalesRep();
  const file = fd.get("file");
  let text = String(fd.get("rows") ?? "").slice(0, 300_000);
  if (file instanceof File && file.size > 0) {
    if (file.size > 1_000_000) back("/sales/leads", { err: "That file is too big. Split it into lists of 500 or fewer." });
    text = await file.text();
  }
  const rows = csvToRows(text, 500).length ? csvToRows(text, 500) : parseLeadRows(text, 500);
  if (rows.length === 0) back("/sales/leads", { err: "Add a CSV with a header row, or paste one business per line." });
  const { data, error } = await db.rpc("sales_crm_import", { p_rows: rows, p_label: String(fd.get("label") ?? "").slice(0, 200) || null });
  if (error) back("/sales/leads", { err: /not_authorized/.test(error.message) ? "Your account can't import leads." : "That list couldn't be imported. Try again." });
  const r = data as { added: number; duplicates: number; possible: number; suppressed: number; invalid: number; existing_customers: number };
  const skipped = r.duplicates + r.possible + r.existing_customers;
  back("/sales/leads", { ok: `Added ${r.added} lead${r.added === 1 ? "" : "s"} to your list.${skipped ? ` ${skipped} were already on file or are customers, so they stay where they are (an admin can review them).` : ""}${r.suppressed ? ` ${r.suppressed} asked not to be contacted.` : ""}${r.invalid ? ` ${r.invalid} were missing a name or a way to reach them.` : ""}` });
}
