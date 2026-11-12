import { processLogo, MAX_LOGO_BYTES } from "@/lib/security/upload";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

/**
 * Validate + normalize a logo to PNG. Signed-in users get it stored privately; visitors get a
 * data URL kept in their browser until they create an account.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!(await rateLimit("logo", 20, 10 * 60_000))) return fail(429, "rate_limited", "Too many uploads. Please wait a few minutes.");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_LOGO_BYTES + 64 * 1024) return fail(413, "too_large", "Logos must be 2 MB or smaller.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "no_file", "Choose an image to upload.");
  const result = await processLogo(Buffer.from(await file.arrayBuffer()), file.type || undefined);
  if (!result.ok) return fail(422, "invalid_image", result.error);

  const user = await getUser();
  if (!user) {
    return json({ dataUrl: `data:image/png;base64,${result.png.toString("base64")}`, stored: false });
  }
  const supabase = await createClient();
  const path = `${user.id}/logo-${Date.now()}.png`;
  const { error } = await supabase.storage.from("logos").upload(path, result.png, { contentType: "image/png", upsert: false });
  if (error) {
    logError("logo.upload", error, { user: user.id });
    return fail(500, "upload_failed", "Upload failed. Please try again.");
  }
  await supabase.from("business_profiles").upsert({ user_id: user.id, logo_path: path }, { onConflict: "user_id" });
  const { data: signed } = await supabase.storage.from("logos").createSignedUrl(path, 3600);
  return json({ path, url: signed?.signedUrl ?? null, stored: true });
}
