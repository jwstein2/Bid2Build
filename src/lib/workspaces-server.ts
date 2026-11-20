import "server-only";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { NO_WORKSPACES, type Workspaces } from "./workspaces";
import { canAdmin, canMy } from "./sales/caps";

/**
 * The signed-in person's workspaces, read with their own session (my_workspaces only returns their own
 * row). Until the V8.9 SQL (20270203001000) is applied it falls back to the Sales Hub capabilities, and
 * treats everyone as having the contractor dashboard, which is how the app behaved before.
 */
export const loadWorkspaces = cache(async function loadWorkspaces(): Promise<Workspaces> {
  const db = await createClient();
  const { data, error } = await db.rpc("my_workspaces");
  if (!error && data) return { ...NO_WORKSPACES, ...(data as Partial<Workspaces>) };
  const caps = await db.rpc("sales_my_capabilities");
  const list = (caps.data as string[] | null) ?? [];
  return { ...NO_WORKSPACES, sales_my: canMy(list), sales_admin: canAdmin(list), contractor: true };
});
