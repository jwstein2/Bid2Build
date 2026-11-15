import "server-only";
import { requireAdmin } from "./server";
import { loadPlatform, type PlatformSnapshot } from "./platform";

/** requireAdmin() + the platform snapshot, with a readable error instead of a crash. */
export async function loadCommandCenter(): Promise<{ p: PlatformSnapshot | null; error: string | null }> {
  const { user, db } = await requireAdmin();
  try {
    return { p: await loadPlatform(db, user.id), error: null };
  } catch (e) {
    console.error("admin.command_center", e);
    return { p: null, error: (e as Error).message };
  }
}
