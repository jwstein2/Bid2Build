import "server-only";
import { createClient } from "../supabase/server";
import { isSupabaseConfigured } from "../env";
import { getTrade, type TradeTemplate } from "./catalog";
import { definitionToTemplate, templateDefinitionSchema } from "./template-schema";

/**
 * Latest published template for a trade. Admin-published versions in the database win over the
 * built-in seed; any failure (no database, invalid row) falls back to the seed.
 */
export async function publishedTemplate(slug: string): Promise<TradeTemplate | undefined> {
  const seed = getTrade(slug)?.template;
  if (!isSupabaseConfigured()) return seed;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("trade_templates").select("version, definition").eq("trade_slug", slug).eq("published", true)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    if (!data) return seed;
    const def = templateDefinitionSchema.safeParse(data.definition);
    if (!def.success || (seed && data.version < seed.version)) return seed;
    return definitionToTemplate(slug, data.version, def.data);
  } catch {
    return seed;
  }
}
