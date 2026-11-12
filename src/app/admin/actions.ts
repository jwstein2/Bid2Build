"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requireAdmin } from "@/lib/admin/server";
import { getTrade } from "@/lib/trades/catalog";
import { parseTemplateText } from "@/lib/trades/template-schema";

export type SaveTemplateResult = { ok: true; version: number; published: boolean } | { ok: false; errors: string[] };

const slug = z.string().regex(/^[a-z0-9-]+$/).max(60);

/** Saves a NEW version (never edits an existing one), so estimates keep pointing at what they used. */
export async function saveTemplateVersion(trade: string, text: string, publish: boolean): Promise<SaveTemplateResult> {
  const { user, db } = await requireAdmin();
  if (!slug.safeParse(trade).success || !getTrade(trade)) return { ok: false, errors: ["Unknown trade."] };
  if (text.length > 50_000) return { ok: false, errors: ["Template is too long."] };
  const parsed = parseTemplateText(text);
  if (!parsed.ok) return parsed;

  const seed = getTrade(trade)!;
  // Make sure the category row exists (seed.sql normally creates it).
  await db.from("trade_categories").upsert({ slug: trade, name: seed.name, icon: seed.icon, family: seed.family, featured: Boolean(seed.featured) }, { onConflict: "slug", ignoreDuplicates: true });

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await db.from("trade_templates").select("version").eq("trade_slug", trade).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = Math.max(last?.version ?? 0, seed.template.version) + 1;
    const { error } = await db.from("trade_templates").insert({ trade_slug: trade, version, definition: parsed.definition, published: publish, created_by: user.id });
    if (!error) {
      await audit(db, user.id, publish ? "template.publish" : "template.save_draft", "trade_template", `${trade}@${version}`, {
        groups: parsed.definition.groups.length,
        items: parsed.definition.groups.reduce((n, g) => n + g.items.length, 0),
      });
      revalidatePath(`/admin/templates/${trade}`);
      revalidatePath("/admin/templates");
      return { ok: true, version, published: publish };
    }
    if (error.code !== "23505") return { ok: false, errors: ["Could not save the template."] };
  }
  return { ok: false, errors: ["Another admin saved at the same time. Reload and try again."] };
}

export async function setTemplatePublished(trade: string, version: number, published: boolean) {
  const { user, db } = await requireAdmin();
  if (!slug.safeParse(trade).success || !Number.isInteger(version)) return;
  const { error } = await db.from("trade_templates").update({ published }).eq("trade_slug", trade).eq("version", version);
  if (error) return;
  await audit(db, user.id, published ? "template.publish" : "template.unpublish", "trade_template", `${trade}@${version}`);
  revalidatePath(`/admin/templates/${trade}`);
}

export async function setFlag(key: string, enabled: boolean) {
  const { user, db } = await requireAdmin();
  if (!/^[a-z0-9_]+$/.test(key)) return;
  const { error } = await db.from("feature_flags").update({ enabled, updated_at: new Date().toISOString() }).eq("key", key);
  if (error) return;
  await audit(db, user.id, enabled ? "flag.enable" : "flag.disable", "feature_flag", key);
  revalidatePath("/admin/flags");
}
