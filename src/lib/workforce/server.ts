import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTargets, mapWorkforce, type TargetProject, type Workforce } from "./model";

/** The directory with every visible assignment, or null before the V7.3 SQL runs (the page explains). */
export async function loadWorkforce(supabase: SupabaseClient): Promise<Workforce | null> {
  const { data, error } = await supabase.rpc("pm_workforce");
  if (error || !data) return null;
  return mapWorkforce(data);
}

/** Open projects the caller can see, with sections and tasks, for the assign flow. */
export async function loadTargets(supabase: SupabaseClient): Promise<TargetProject[] | null> {
  const { data, error } = await supabase.rpc("pm_assign_targets");
  if (error) return null;
  return mapTargets(data);
}
