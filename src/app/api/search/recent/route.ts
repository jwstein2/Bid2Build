import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError } from "@/lib/http/api";
import { missingMigration } from "@/lib/operations/server";
import { defaultActions } from "@/lib/search/actions";
import { hrefFor, isSearchKind, kindLabel, groupOf } from "@/lib/search/kinds";
import { loadCaps, searchableKinds } from "@/lib/search/server";

export const runtime = "nodejs";

type Rec = { kind: string; id: string; title: string; subtitle: string | null; estimate_id: string | null; schedule_id: string | null; customer_id: string | null; parent_id: string | null; owned: boolean };

/** Recent searches, recently opened records (re-checked through RLS; records the user lost access to are removed) and suggested actions. */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const db = await createClient();
  try {
    const caps = await loadCaps(db);
    if (!caps) return json({ available: false, historyEnabled: false, queries: [], records: [], actions: [] });
    const { data, error } = await db.rpc("search_recent");
    if (error) { if (missingMigration(error)) return json({ available: false, historyEnabled: false, queries: [], records: [], actions: [] }); throw error; }
    const d = (data ?? {}) as { history_enabled?: boolean; queries?: string[]; records?: Rec[]; favorite_actions?: string[] };
    // Recently opened records of a kind now turned off for this person (Team & Access) are left out.
    const kinds = new Set<string>(searchableKinds(caps));
    const records = (d.records ?? []).filter((r) => isSearchKind(r.kind) && kinds.has(r.kind)).slice(0, 6).map((r) => {
      const kind = r.kind as Parameters<typeof hrefFor>[0]["kind"];
      // Resource status isn't stored in history; the subtitle carries its kind (staff / subcontractor / crew).
      const status = kind === "resource" ? r.subtitle : null;
      return { kind, id: r.id, group: groupOf(kind), title: r.title, subtitle: kind === "resource" ? null : r.subtitle, kindLabel: kindLabel(kind, status),
        href: hrefFor({ kind, id: r.id, estimate_id: r.estimate_id, schedule_id: r.schedule_id, customer_id: r.customer_id, parent_id: r.parent_id, owned: r.owned, status }) };
    });
    return json({ available: true, historyEnabled: d.history_enabled !== false, queries: (d.queries ?? []).slice(0, 6), records, actions: defaultActions(caps, d.favorite_actions ?? []), favorites: d.favorite_actions ?? [] });
  } catch (e) {
    logError("search.recent", e);
    return fail(500, "server_error", "We couldn't load recent searches.");
  }
}
