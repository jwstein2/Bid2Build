import "server-only";
import { requireAdmin } from "./server";
import { loadSnapshot } from "./platform";
import { accountFacts, scope, type AccountFact, type Scoped, type Snapshot } from "./model";
import { parseView, type View } from "./view";

type SP = Record<string, string | string[] | undefined>;

export interface Report { snap: Snapshot; sc: Scoped; facts: AccountFact[]; view: View; now: Date; userId: string }

/**
 * requireAdmin() + the owner snapshot scoped to genuine accounts (or everything when the owner turns
 * on "Include test data"), with a readable error instead of a crash. Every owner page starts here so
 * all pages share one definition of each metric.
 */
export async function loadReport(sp: SP): Promise<{ r: Report | null; error: string | null; view: View }> {
  const view = parseView(sp);
  const { user, db } = await requireAdmin();
  try {
    const snap = await loadSnapshot(db, user.id);
    const now = new Date();
    const sc = scope(snap, view.includeTest);
    return { r: { snap, sc, facts: accountFacts(sc, now), view, now, userId: user.id }, error: null, view };
  } catch (e) {
    console.error("admin.command_center", e);
    return { r: null, error: (e as Error).message, view };
  }
}
