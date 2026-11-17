import "server-only";
/** Shared guard for the Financials API routes: flag, origin, rate limit, sign-in, and the caller's book. */
import { createClient, getUser } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { fail, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { FinError, myBook } from "./server";
import { finErrorText } from "./ui-labels";
import { isMissing } from "./loaders";

export async function finGuard(opts: { write: boolean; limitKey: string; limit?: number }) {
  if (!isFinancialsEnabled()) return { error: fail(404, "not_found", "Not found.") } as const;
  if (opts.write && !(await sameOrigin())) return { error: fail(403, "bad_origin", "Cross-site request refused.") } as const;
  if (!(await rateLimit(opts.limitKey, opts.limit ?? 240, 10 * 60_000))) return { error: fail(429, "rate_limited", "Please wait a moment and try again.") } as const;
  const user = await getUser();
  if (!user) return { error: fail(401, "not_authenticated", "Sign in required.") } as const;
  const db = await createClient();
  let bookId: string | null = null;
  try { bookId = await myBook(db); } catch (e) {
    if (isMissing(e as { message?: string })) return { error: fail(503, "not_installed", "Financials turns on after the database update is installed.") } as const;
    throw e;
  }
  if (!bookId) return { error: fail(403, "no_book", "Ask your company owner to set up Financials.") } as const;
  return { db, user, bookId } as const;
}

/** Map a database error to a response. Codes come from the SQL (raise exception '<code>'). */
export function finFail(e: unknown, scope: string) {
  if (e instanceof FinError) {
    const code = e.code.split(/\s/)[0];
    const status = code === "forbidden" || code === "read_only" ? 403 : code === "not_found" ? 404 : 409;
    let detail: unknown = undefined;
    if (e.detail) { try { detail = JSON.parse(e.detail); } catch { detail = e.detail; } }
    if (!/^[a-z_]+$/.test(code)) { logError(scope, e); return fail(500, "server_error", finErrorText(null)); }
    return fail(status, code, finErrorText(code), detail !== undefined ? { detail } : {});
  }
  logError(scope, e);
  return fail(500, "server_error", finErrorText(null));
}
