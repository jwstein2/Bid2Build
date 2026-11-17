import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sniffImage } from "@/lib/security/upload";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 10;

export interface ProcessedPhoto { full: Buffer; thumb: Buffer; width: number; height: number }

/**
 * Validate an uploaded photo by its content and re-encode it. Re-encoding drops all metadata
 * (including GPS location and camera serials) and applies the EXIF rotation first.
 */
export async function processPhoto(buf: Buffer): Promise<ProcessedPhoto | { error: string }> {
  if (!buf.length) return { error: "The file is empty." };
  if (buf.length > MAX_PHOTO_BYTES) return { error: "Photos must be 10 MB or smaller." };
  const kind = sniffImage(buf);
  if (kind !== "jpeg" && kind !== "png" && kind !== "webp") return { error: "Upload JPG, PNG or WebP photos (on iPhone, Camera › Formats › Most Compatible)." };
  try {
    const img = sharp(buf, { limitInputPixels: 80_000_000 }).rotate();
    const full = await img.clone().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    const meta = await sharp(full).metadata();
    const thumb = await img.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    return { full, thumb, width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    return { error: "We couldn't read this image." };
  }
}

export async function storePhoto(admin: SupabaseClient, prefix: string, p: ProcessedPhoto) {
  const id = randomUUID();
  const storagePath = `${prefix}/photos/${id}.jpg`;
  const thumbPath = `${prefix}/photos/${id}-thumb.webp`;
  const a = await admin.storage.from("project-photos").upload(storagePath, p.full, { contentType: "image/jpeg", upsert: false });
  if (a.error) throw a.error;
  const b = await admin.storage.from("project-photos").upload(thumbPath, p.thumb, { contentType: "image/webp", upsert: false });
  if (b.error) { await admin.storage.from("project-photos").remove([storagePath]); throw b.error; }
  return { id, storagePath, thumbPath };
}

/** Short-lived signed URLs for photos the caller could already read through RLS. */
export async function signPhotos<T extends { storage_path: string; thumb_path: string | null }>(admin: SupabaseClient, rows: T[], seconds = 3600) {
  const paths = rows.flatMap((r) => [r.storage_path, r.thumb_path ?? r.storage_path]);
  if (!paths.length) return rows.map((r) => ({ ...r, url: null as string | null, thumbUrl: null as string | null }));
  const { data } = await admin.storage.from("project-photos").createSignedUrls(paths, seconds);
  const map = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => ({ ...r, url: map.get(r.storage_path) ?? null, thumbUrl: map.get(r.thumb_path ?? r.storage_path) ?? null }));
}

/** AI label suggestions are opt-in: PHOTO_AI_LABELS=on plus a configured AI key. */
export const isPhotoAiEnabled = () => ["on", "true", "1"].includes((process.env.PHOTO_AI_LABELS ?? "").trim().toLowerCase());

/**
 * Company/owner AI & Automation switch for photo labeling (fin_ai_preferences.photo_labeling). Only an
 * explicit OFF stops suggestions: no financial book, no saved preference, or the Financials migrations not
 * applied yet all keep today's behavior (the column defaults to ON). Looked up with the admin client
 * because the person asking may have no financial seat; it reads one boolean and nothing else.
 */
export async function photoAiAllowedFor(admin: SupabaseClient, scope: { estimateId?: string | null; customerId?: string | null }): Promise<boolean> {
  try {
    let owner: { company_id: string | null; user_id: string | null } | null = null;
    if (scope.estimateId) owner = (await admin.from("estimates").select("company_id, user_id").eq("id", scope.estimateId).maybeSingle()).data;
    if (!owner && scope.customerId) owner = (await admin.from("customers").select("company_id, user_id").eq("id", scope.customerId).maybeSingle()).data;
    if (!owner) return true;
    const book = owner.company_id
      ? await admin.from("fin_books").select("id").eq("company_id", owner.company_id).maybeSingle()
      : await admin.from("fin_books").select("id").eq("owner_user_id", owner.user_id).maybeSingle();
    if (book.error || !book.data) return true;
    const pref = await admin.from("fin_ai_preferences").select("photo_labeling").eq("book_id", book.data.id).maybeSingle();
    if (pref.error || !pref.data) return true;
    return pref.data.photo_labeling !== false;
  } catch {
    return true;
  }
}
