"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requireAdmin } from "@/lib/admin/server";
import { LEGAL_DOCUMENT_KEYS, LEGAL_STATUSES } from "@/lib/legal/registry";

const Input = z.object({
  docKey: z.string().refine((k) => LEGAL_DOCUMENT_KEYS.includes(k)),
  status: z.enum(LEGAL_STATUSES),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: z.string().max(2000).nullable(),
});

const ERRORS: Record<string, string> = {
  completion_date_required: "Enter the date counsel completed the review.",
  completion_date_only_when_reviewed: "A completion date is only recorded with Reviewed by Legal Counsel.",
  completion_date_future: "The completion date can't be in the future.",
  notes_too_long: "Notes can be up to 2,000 characters.",
};

/**
 * Platform owner records a document's legal-review status. Platform admins only (requireAdmin, and the
 * database function checks is_admin again). Never touches the document text, its dates or acceptance records.
 */
export async function setLegalStatus(form: FormData) {
  const { user, db } = await requireAdmin();
  const str = (k: string) => { const v = form.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
  const p = Input.safeParse({ docKey: str("doc_key"), status: str("status"), completedOn: str("completed_on"), notes: str("notes") });
  if (!p.success) redirect(`/admin/legal?err=${encodeURIComponent("Check the status and date.")}`);
  const { docKey, status, completedOn, notes } = p.data;
  const { data, error } = await db.rpc("admin_legal_set_status", { p_caller: user.id, p_doc_key: docKey, p_status: status, p_review_completed_on: status === "reviewed" ? completedOn : null, p_internal_notes: notes });
  const res = data as { ok: boolean; error?: string } | null;
  if (error || !res?.ok) {
    const msg = error ? "Couldn't save. Has the legal status SQL been run?" : ERRORS[res?.error ?? ""] ?? "Couldn't save.";
    redirect(`/admin/legal?err=${encodeURIComponent(msg)}#doc-${docKey}`);
  }
  await audit(db, user.id, "legal.status_set", "legal_document", docKey, { status, review_completed_on: status === "reviewed" ? completedOn : null });
  revalidatePath("/admin/legal");
  revalidatePath("/legal");
  redirect(`/admin/legal?msg=${encodeURIComponent("Status saved.")}#doc-${docKey}`);
}
