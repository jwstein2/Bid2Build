import "server-only";
import { fail } from "@/lib/http/api";
import { hrDbError } from "./hr";
import { dbFail } from "./route-helpers";

/** HR routes: plain-words HR errors first, then the shared team-records mapping. */
export function hrFail(where: string, error: { message?: string; code?: string }) {
  const m = hrDbError(error);
  return m ? fail(m.status, m.code, m.message) : dbFail(where, error);
}
