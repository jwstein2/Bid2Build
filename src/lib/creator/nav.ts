import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearningNav } from "@/components/layout/app-nav";

/**
 * Sidebar links for the invitation-only program. Tolerates the migration not being applied yet
 * (the RPCs simply error and no link is shown), so regular accounts see no change.
 */
export async function loadLearningNav(db: SupabaseClient): Promise<LearningNav | null> {
  const [c, m] = await Promise.all([db.rpc("my_creator_programs"), db.rpc("my_mentorship")]);
  const creator = !c.error && Array.isArray(c.data) && c.data.length > 0;
  const participant = !m.error && Array.isArray(m.data) && m.data.length > 0;
  return creator || participant ? { creator, participant } : null;
}
