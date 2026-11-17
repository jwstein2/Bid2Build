import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sniffImage } from "@/lib/security/upload";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_QUOTE_FILE_BYTES = 15 * 1024 * 1024;

/** Map project-operations database errors to API responses without leaking internals. */
export function opsDbError(e: { message?: string; code?: string; details?: string } | null): { status: number; code: string; message: string } {
  const m = e?.message ?? "";
  if (m.includes("stale_revision")) return { status: 409, code: "stale_revision", message: "Someone else saved a change first. Reload to see the latest version." };
  if (m.includes("not_accepted")) return { status: 409, code: "not_accepted", message: "Change orders start after the proposal is approved or signed." };
  if (m.includes("not_draft") || m.includes("bad_state")) return { status: 409, code: "bad_state", message: "This document has moved on since you opened it. Reload to see its current status." };
  if (m.includes("note_required")) return { status: 400, code: "note_required", message: "Add a note describing how the customer approved this change order." };
  if (m.includes("no_lines")) return { status: 400, code: "no_lines", message: "Add at least one line before sending." };
  if (m.includes("forbidden_template")) return { status: 403, code: "forbidden_template", message: "You need “Manage company proposal templates” to change the company style." };
  if (m.includes("forbidden_policy")) return { status: 403, code: "forbidden_policy", message: "Only the company owner (or someone they allow) can change the customization policy and locks." };
  if (m.includes("forbidden_confirm")) return { status: 403, code: "forbidden_confirm", message: "Your company role can't confirm task completion." };
  if (m.includes("forbidden_live_edit")) return { status: 403, code: "forbidden_live_edit", message: "Your company role can't change dates on a live schedule." };
  if (m.includes("forbidden") || e?.code === "42501" || m.includes("not_found")) return { status: 403, code: "forbidden", message: "You don't have permission to do that." };
  if (m.includes("unknown_item")) return { status: 409, code: "unknown_item", message: "Save the estimate first, then add the quote to this line." };
  if (m.includes("vendor_required")) return { status: 400, code: "vendor_required", message: "Choose someone from your Team directory or type the vendor's name." };
  if (m.includes("bad_resource")) return { status: 400, code: "bad_resource", message: "Pick someone from your own Team directory." };
  if (m.includes("bad_key")) return { status: 400, code: "bad_key", message: "That style setting isn't recognized." };
  if (m.includes("too_many_labels")) return { status: 400, code: "too_many_labels", message: "Use 10 labels or fewer." };
  if (e?.code === "22023" || e?.code === "23514" || e?.code === "22P02") return { status: 400, code: "invalid", message: "Check the details and try again." };
  return { status: 500, code: "server_error", message: "Something went wrong. Please try again." };
}

/** True when the database doesn't have the V4.3/V4.4 SQL yet (function or table missing). */
export const missingMigration = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42883" || e.code === "42P01" || e.code === "PGRST202" || e.code === "PGRST205" || /does not exist|could not find the function/i.test(e.message ?? "")));

export type DocKind = "pdf" | "jpeg" | "png" | "webp";
const DOC_MIME: Record<DocKind, string> = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Quote documents: PDF or image, checked by content (never by the file name or declared type alone). */
export function sniffDocument(buf: Buffer): DocKind | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  const img = sniffImage(buf);
  return img === "png" || img === "jpeg" || img === "webp" ? img : null;
}

export const safeFileName = (name: string) => (name.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "document");

/** Store a validated document in the private project-files bucket (service role). */
export async function storeProjectFile(admin: SupabaseClient, prefix: string, folder: string, buf: Buffer, kind: DocKind): Promise<string> {
  const path = `${prefix}/${folder}/${randomUUID()}.${kind === "jpeg" ? "jpg" : kind}`;
  const { error } = await admin.storage.from("project-files").upload(path, buf, { contentType: DOC_MIME[kind], upsert: false });
  if (error) throw error;
  return path;
}
