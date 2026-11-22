"use server";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";
import { logError } from "@/lib/http/api";

/**
 * Manage → Codes. Every action re-checks the Academy role on the server. Verification goes through academy_kb_verify()
 * as the signed-in admin (the database records who verified what, with evidence); queue/feedback/document writes use
 * the service role after the role check, with an audit-log entry, like the rest of Manage Academy.
 */
const PATH = "/academy/manage/codes";
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const go = (q: Record<string, string>): never => redirect(`${PATH}?${new URLSearchParams(q)}`);
const uuid = z.string().uuid();

async function staff(roles: ("admin" | "instructor")[]) {
  const s = await requireAcademyStaff(roles);
  if (!s) go({ err: "You don't have permission to do that." });
  return { ...s!, admin: createAdminClient() };
}
async function audit(actor: string, action: string, type: string, id: string | null, details?: Record<string, unknown>) {
  const { error } = await createAdminClient().from("academy_audit_log").insert({ actor_id: actor, action, target_type: type, target_id: id, details: details ?? null });
  if (error) logError("academy.kb.audit", error);
}

export async function setKbEnabled(form: FormData) {
  const { user, admin } = await staff(["admin"]);
  const on = str(form, "on") === "1";
  const { error } = await admin.from("academy_settings").update({ kb_enabled: on }).eq("id", true);
  if (error) go({ err: "Couldn't save. Has the knowledge-engine SQL been applied?" });
  await audit(user.id, on ? "kb_enable" : "kb_disable", "settings", null);
  revalidatePath("/academy", "layout");
  go({ msg: on ? "Codes is on for everyone." : "Codes is now staff-only." });
}

const RESULTS = ["verified", "unchanged", "changed", "unreachable", "rejected", "superseded"] as const;
const METHODS = ["official_text", "manual_review", "research", "url_check"] as const;
const CHANGE = ["new_publication", "new_adoption", "local_amendment", "effective_date_change", "administrative_correction", "superseded_edition", "unchanged", "unknown"] as const;

/** Records a verification check (and status change) on a source, adoption or section. Admin only; evidence required to verify. */
export async function recordCheck(form: FormData) {
  await staff(["admin"]);
  const type = str(form, "target_type"), id = str(form, "target_id"), result = str(form, "result"), method = str(form, "method"), change = str(form, "change_kind");
  if (!["source", "adoption", "section"].includes(type) || !uuid.safeParse(id).success) go({ err: "Item not found." });
  if (!(RESULTS as readonly string[]).includes(result) || !(METHODS as readonly string[]).includes(method)) go({ err: "Choose a result and a method." });
  const url = str(form, "source_url");
  if (url && !/^https:\/\//.test(url)) go({ err: "The official link must start with https://" });
  const db = await createClient();
  const { error } = await db.rpc("academy_kb_verify", {
    p_target_type: type, p_target_id: id, p_method: method, p_result: result, p_source_url: url || null, p_evidence: str(form, "evidence").slice(0, 4000) || null,
    p_content_hash: null, p_http_status: null, p_change_kind: (CHANGE as readonly string[]).includes(change) ? change : null, p_notes: str(form, "notes").slice(0, 2000) || null,
  });
  if (error) go({ err: /evidence_required/.test(error.message) ? "To mark it verified, add the official https link and quote the text that proves it." : /admin_only/.test(error.message) ? "Only Academy admins can verify." : "Couldn't record the check." });
  revalidatePath(PATH);
  go({ msg: `Recorded: ${result}.` });
}

export async function resolveQueue(form: FormData) {
  const { user, admin } = await staff(["admin", "instructor"]);
  const id = str(form, "id"), status = str(form, "status");
  if (!uuid.safeParse(id).success || !["in_review", "approved", "rejected", "deferred", "done"].includes(status)) go({ err: "Item not found." });
  const done = ["approved", "rejected", "done"].includes(status);
  const { error } = await admin.from("academy_kb_review_queue").update({ status, resolution_note: str(form, "note").slice(0, 2000) || null, resolved_by: done ? user.id : null, resolved_at: done ? new Date().toISOString() : null }).eq("id", id);
  if (error) go({ err: "Couldn't update the item." });
  await audit(user.id, `kb_queue_${status}`, "kb_review", id);
  revalidatePath(PATH);
  go({ msg: "Review item updated." });
}

export async function resolveFeedback(form: FormData) {
  const { user, admin } = await staff(["admin", "instructor"]);
  const id = str(form, "id"), status = str(form, "status");
  if (!uuid.safeParse(id).success || !["reviewing", "resolved", "dismissed"].includes(status)) go({ err: "Report not found." });
  const done = status !== "reviewing";
  const { error } = await admin.from("academy_kb_feedback").update({ status, resolution_note: str(form, "note").slice(0, 2000) || null, resolved_by: done ? user.id : null, resolved_at: done ? new Date().toISOString() : null }).eq("id", id);
  if (error) go({ err: "Couldn't update the report." });
  await audit(user.id, `kb_feedback_${status}`, "kb_feedback", id);
  revalidatePath(PATH);
  go({ msg: "Report updated." });
}

/**
 * Registers an official URL or uploads a PDF that Built2Bid has the right to hold (public-domain or government text,
 * or a written licence). Uploads are stored privately, deduplicated by SHA-256, and queued for review. Nothing is
 * extracted or published automatically.
 */
export async function registerDocument(form: FormData) {
  const { user, admin } = await staff(["admin"]);
  const title = str(form, "title"), rights = str(form, "rights_basis"), url = str(form, "url"), sourceId = str(form, "source_id");
  if (title.length < 3 || title.length > 200) go({ err: "Give the document a title (3 to 200 characters)." });
  if (rights.length < 10) go({ err: "Explain why Built2Bid may hold this document (for example: U.S. Government work, or the licence)." });
  if (str(form, "confirm") !== "on") go({ err: "Confirm that Built2Bid has the right to store this document." });
  if (sourceId && !uuid.safeParse(sourceId).success) go({ err: "Choose a valid publication." });
  const file = form.get("file");
  let row: Record<string, unknown>;
  if (file instanceof File && file.size > 0) {
    if (file.size > 100 * 1024 * 1024) go({ err: "PDFs can be up to 100 MB." });
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") go({ err: "That file isn't a PDF." });
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const { data: dup } = await admin.from("academy_kb_documents").select("id").eq("sha256", sha256).maybeSingle();
    if (dup) go({ err: "That PDF is already on file." });
    const path = `${new Date().getUTCFullYear()}/${randomUUID()}.pdf`;
    const up = await admin.storage.from("academy-kb").upload(path, buf, { contentType: "application/pdf", upsert: false });
    if (up.error) go({ err: "Upload failed. Has the knowledge-engine SQL been applied?" });
    row = { kind: "pdf", storage_path: path, sha256, bytes: buf.length };
  } else if (url) {
    if (!/^https:\/\/[^\s]+$/.test(url)) go({ err: "The link must start with https://" });
    row = { kind: "url", url };
  } else {
    return go({ err: "Add an official link or choose a PDF." });
  }
  const { data, error } = await admin.from("academy_kb_documents").insert({ ...row, title, rights_basis: rights.slice(0, 1000), rights_confirmed_by: user.id, source_id: sourceId || null, status: "review", notes: str(form, "notes").slice(0, 2000) || null, created_by: user.id }).select("id").single();
  if (error || !data) {
    if (row.storage_path) await admin.storage.from("academy-kb").remove([row.storage_path as string]);
    go({ err: error?.code === "23505" ? "That document is already on file." : "Couldn't save the document." });
  }
  await admin.from("academy_kb_review_queue").insert({ kind: "new_document", title: `New document: ${title}`.slice(0, 200), detail: "Review the rights basis, then add the sections it supports.", target_type: "document", target_id: data!.id, priority: 3, dedupe_key: `doc:${data!.id}` });
  await audit(user.id, "kb_document_add", "kb_document", data!.id, { kind: row.kind });
  revalidatePath(PATH);
  go({ msg: "Document saved and queued for review." });
}

/** Runs the 50-state + DC coverage audit now (real searches, no AI, no outside calls). Admins and instructors. */
export async function runCoverageAudit() {
  const { user } = await staff(["admin", "instructor"]);
  const { data, error } = await (await createClient()).rpc("academy_kb_run_coverage_audit", { p_trigger: "manual" });
  if (error) {
    if (/rate_limited/.test(error.message)) redirect("/academy/manage/codes/coverage?err=" + encodeURIComponent("An audit just ran. Try again in a few minutes."));
    logError("academy.kb.coverage_audit", error);
    redirect("/academy/manage/codes/coverage?err=" + encodeURIComponent("The audit couldn't run. Has the coverage-audit SQL been applied?"));
  }
  await audit(user.id, "kb_coverage_audit", "coverage_run", typeof data === "string" ? data : null);
  revalidatePath("/academy/manage/codes/coverage");
  redirect("/academy/manage/codes/coverage?msg=" + encodeURIComponent("Coverage audit finished."));
}
