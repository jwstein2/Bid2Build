import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { isAiConfigured } from "@/lib/ai/provider";
import { UUID, missingMigration } from "@/lib/operations/server";
import { isPhotoAiEnabled, photoAiAllowedFor, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_UPLOAD, processPhoto, signPhotos, storePhoto } from "@/lib/operations/photos-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const COLS = "id, customer_id, estimate_id, scope_section_id, storage_path, thumb_path, width, height, taken_on, caption, labels, ai_labels, ai_status, created_at, uploaded_by, archived_at";

/** Photos for a project (?estimateId=) or a customer (?customerId=, includes their projects' photos). */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const sp = new URL(req.url).searchParams;
  const estimateId = sp.get("estimateId"), customerId = sp.get("customerId");
  if (!(estimateId && UUID.test(estimateId)) && !(customerId && UUID.test(customerId))) return fail(400, "invalid", "Choose a project or customer.");
  const supabase = await createClient();
  let q = supabase.from("project_photos").select(COLS).order("created_at", { ascending: false }).limit(300);
  q = estimateId ? q.eq("estimate_id", estimateId) : q.eq("customer_id", customerId!);
  if (sp.get("archived") !== "1") q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) {
    if (missingMigration(error)) return json({ available: false, photos: [] });
    logError("photos.list", error);
    return fail(500, "server_error", "We couldn't load photos.");
  }
  const { data: canUpload } = await supabase.rpc("can_upload_photos", { p_customer_id: customerId, p_estimate_id: estimateId });
  const admin = createAdminClient();
  const photos = await signPhotos(admin, (data ?? []) as { storage_path: string; thumb_path: string | null }[]);
  const aiEnabled = isPhotoAiEnabled() && isAiConfigured() && (await photoAiAllowedFor(admin, { estimateId, customerId }));
  return json({
    available: true, canUpload: canUpload === true, aiEnabled,
    photos: photos.map(({ storage_path: _s, thumb_path: _t, ...p }) => { void _s; void _t; return p; }),
  });
}

/**
 * Upload photos (multipart, up to 10 per request, 10 MB each). Files are checked by content,
 * re-encoded (location data removed) and stored privately in Built2Bid. Nothing goes to an AI service.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("photo-upload", 60, 10 * 60_000))) return fail(429, "rate_limited", "Too many uploads. Please wait a few minutes.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PHOTOS_PER_UPLOAD * MAX_PHOTO_BYTES + 256 * 1024) return fail(413, "too_large", "Upload up to 10 photos at a time, 10 MB each.");
  const form = await req.formData().catch(() => null);
  if (!form) return fail(400, "invalid", "Choose photos to upload.");
  const str = (k: string) => { const v = form.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
  const estimateId = str("estimateId"), customerId = str("customerId"), sectionId = str("scopeSectionId");
  if ((estimateId && !UUID.test(estimateId)) || (customerId && !UUID.test(customerId)) || (sectionId && !UUID.test(sectionId)) || (!estimateId && !customerId)) return fail(400, "invalid", "Choose a project or customer.");
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return fail(400, "no_file", "Choose photos to upload.");
  if (files.length > MAX_PHOTOS_PER_UPLOAD) return fail(400, "too_many", "Upload up to 10 photos at a time.");

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_upload_photos", { p_customer_id: customerId, p_estimate_id: estimateId });
  if (allowed !== true) return fail(403, "forbidden", "Your company role can't upload photos here.");
  const owner = estimateId
    ? (await supabase.from("estimates").select("user_id, company_id").eq("id", estimateId).maybeSingle()).data
    : (await supabase.from("customers").select("user_id, company_id").eq("id", customerId!).maybeSingle()).data;
  if (!owner) return fail(404, "not_found", "Not found.");
  const prefix = String(owner.company_id ?? owner.user_id);
  const admin = createAdminClient();
  const caption = str("caption"), takenOn = str("takenOn");
  const out: { id: string; name: string }[] = [], failed: { name: string; error: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_PHOTO_BYTES) { failed.push({ name: f.name, error: "Photos must be 10 MB or smaller." }); continue; }
    const p = await processPhoto(Buffer.from(await f.arrayBuffer()));
    if ("error" in p) { failed.push({ name: f.name, error: p.error }); continue; }
    try {
      const stored = await storePhoto(admin, prefix, p);
      const { data, error } = await admin.rpc("photo_register", { p_actor: user.id, p: {
        id: stored.id, estimateId, customerId, storagePath: stored.storagePath, thumbPath: stored.thumbPath, contentType: "image/jpeg", bytes: p.full.length,
        width: p.width, height: p.height, takenOn: takenOn && /^\d{4}-\d{2}-\d{2}$/.test(takenOn) ? takenOn : null, caption } });
      if (error) { await admin.storage.from("project-photos").remove([stored.storagePath, stored.thumbPath]); throw error; }
      if (sectionId) await supabase.rpc("photo_update", { p_id: data as string, p: { scopeSectionId: sectionId } });
      out.push({ id: data as string, name: f.name });
    } catch (e) {
      logError("photos.upload", e);
      failed.push({ name: f.name, error: "We couldn't save this photo." });
    }
  }
  return json({ uploaded: out, failed }, out.length ? 201 : 422);
}
