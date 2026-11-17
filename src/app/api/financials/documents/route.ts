import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { sniffImage } from "@/lib/security/upload";
import { finFail, finGuard } from "@/lib/financials/api";
import { FinError, finAccess } from "@/lib/financials/server";

export const runtime = "nodejs";
const MAX = 20 * 1024 * 1024;

/**
 * Upload one receipt or vendor bill (multipart "file", optional "kind" receipt|vendor_bill) to the private
 * financial-documents bucket, then register it (fin_document_register re-checks record_expenses and the
 * entitlement). Files are checked by content (PDF, JPG, PNG or WebP). Nothing is sent to an AI service.
 */
export async function POST(req: Request) {
  const g = await finGuard({ write: true, limitKey: "fin-doc", limit: 60 });
  if ("error" in g) return g.error;
  const { db, bookId } = g;
  const access = await finAccess(db, bookId).catch(() => null);
  if (!access?.permissions.includes("record_expenses") || access.readOnly || !access.active) return fail(403, "forbidden", "Your financial role can't add receipts.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "invalid", "Choose a file.");
  if (!file.size || file.size > MAX) return fail(400, "too_large", "Receipts must be 20 MB or smaller.");
  const kind = form?.get("kind") === "vendor_bill" ? "vendor_bill" : "receipt";
  const buf = Buffer.from(await file.arrayBuffer());
  const img = sniffImage(buf);
  const isPdf = buf.subarray(0, 5).toString("ascii") === "%PDF-";
  if (!isPdf && img !== "jpeg" && img !== "png" && img !== "webp") return fail(400, "bad_type", "Upload a PDF, JPG, PNG or WebP.");
  const ext = isPdf ? "pdf" : img === "jpeg" ? "jpg" : img!;
  const contentType = isPdf ? "application/pdf" : `image/${img}`;
  const storagePath = `${bookId}/${kind}/${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const up = await admin.storage.from("financial-documents").upload(storagePath, buf, { contentType, upsert: false });
  if (up.error) { logError("financials.doc.upload", up.error); return fail(500, "upload_failed", "We couldn't store the file. Try again."); }
  try {
    const { data, error } = await db.rpc("fin_document_register", { p_book_id: bookId, p: {
      kind, storagePath, sha256: createHash("sha256").update(buf).digest("hex"), contentType, bytes: buf.length, originalName: file.name.slice(0, 200),
    } });
    if (error) throw new FinError(error.message, error.message);
    return json({ documentId: data as string, name: file.name });
  } catch (e) {
    await admin.storage.from("financial-documents").remove([storagePath]);
    return finFail(e, "financials.doc.register");
  }
}
