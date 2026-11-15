import { z } from "zod";
import { colorCheck, contrastRatio, mergeBranding } from "@/lib/onboarding/brand-review";
import { processLogo } from "@/lib/security/upload";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";

export const runtime = "nodejs";

/**
 * Save the branding the user APPROVED in onboarding (each field was accepted, edited or removed by them).
 * Existing company profile values are never overwritten unless the field is listed in `replace`.
 * A logo (data URL from the preview) is re-validated and re-encoded by the same pipeline as uploads
 * and stored privately in the user's own folder. Runs as the user (RLS), never the service role.
 */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((v) => v.toLowerCase());
const opt = (max: number) => z.string().trim().max(max).optional();
const Body = z.object({
  fields: z.object({
    companyName: opt(200), tagline: opt(200), primaryColor: hex.optional(), secondaryColor: hex.optional(), email: z.string().trim().max(320).email().optional().or(z.literal("")),
    phone: opt(50), address: opt(500), website: z.string().trim().max(500).regex(/^https?:\/\//).optional().or(z.literal("")), licenseNumber: opt(100), trade: opt(80), services: opt(1000),
  }),
  logoDataUrl: z.string().max(3_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
  replace: z.array(z.string().max(40)).max(20).default([]),
  website: z.string().max(500).optional(),
  skipped: z.boolean().optional(),
});

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await rateLimit(`branding:${user.id}`, 20, 10 * 60_000))) return fail(429, "rate_limited", "Too many saves. Try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "Some fields are invalid.", { issues: parsed.error.issues.slice(0, 10).map((i) => i.path.join(".")) });
  const { fields, replace } = parsed.data;
  if (fields.primaryColor && contrastRatio(fields.primaryColor, "#ffffff") < 3) {
    return fail(422, "low_contrast", `That primary color is too light to read on white proposals. Try ${colorCheck(fields.primaryColor).suggestion}.`);
  }
  const supabase = await createClient();
  const { data: existing } = await supabase.from("business_profiles").select("company_name, tagline, primary_color, secondary_color, email, phone, address, website, license_number, primary_trade, description, logo_path").eq("user_id", user.id).maybeSingle();
  const current = {
    companyName: existing?.company_name, tagline: existing?.tagline, primaryColor: existing?.primary_color, secondaryColor: existing?.secondary_color,
    email: existing?.email, phone: existing?.phone, address: existing?.address, website: existing?.website, licenseNumber: existing?.license_number,
    trade: existing?.primary_trade, services: existing?.description,
  };
  const merged = mergeBranding(current, fields, new Set(replace));
  const row: Record<string, unknown> = { user_id: user.id };
  const map: Record<string, string> = { companyName: "company_name", tagline: "tagline", primaryColor: "primary_color", secondaryColor: "secondary_color", email: "email", phone: "phone", address: "address", website: "website", licenseNumber: "license_number", trade: "primary_trade", services: "description" };
  for (const [k, v] of Object.entries(merged)) if (map[k]) row[map[k]] = v;

  let logoSaved = false;
  if (parsed.data.logoDataUrl && (!existing?.logo_path || replace.includes("logo"))) {
    const [meta, b64] = parsed.data.logoDataUrl.split(",");
    const processed = await processLogo(Buffer.from(b64, "base64"), meta.slice(5, meta.indexOf(";")));
    if (!processed.ok) return fail(422, "invalid_image", processed.error);
    const path = `${user.id}/logo-${Date.now()}.png`;
    const { error } = await supabase.storage.from("logos").upload(path, processed.png, { contentType: "image/png", upsert: false });
    if (error) { logError("onboarding.logo", error, { user: user.id }); return fail(500, "upload_failed", "Your logo couldn't be saved. Everything else can be saved without it."); }
    row.logo_path = path;
    logoSaved = true;
  }
  let host: string | null = null;
  try { host = parsed.data.website ? new URL(parsed.data.website).hostname : null; } catch { /* ignore */ }
  row.branding_source = { via: "onboarding", website_host: host, fields: Object.keys(merged), logo: logoSaved, kept_existing: Object.keys(fields).filter((k) => !(k in merged)), skipped: Boolean(parsed.data.skipped), at: new Date().toISOString() };
  if (!existing && !row.company_name) row.company_name = "";
  const { error } = await supabase.from("business_profiles").upsert(row, { onConflict: "user_id" });
  if (error) { logError("onboarding.branding", error, { user: user.id }); return fail(500, "save_failed", "Couldn't save your company profile."); }
  return json({ ok: true, saved: Object.keys(merged), logo: logoSaved });
}
