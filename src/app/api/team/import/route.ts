import { z } from "zod";
import { fail, json, logError } from "@/lib/http/api";
import { IMPORT_CHUNK } from "@/lib/team/import";
import { runImport } from "@/lib/team/import-server";
import { dbFail, guardWrite } from "@/lib/team/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 26;

const body = z.object({
  kind: z.enum(["employees", "subs"]),
  dryRun: z.boolean().default(false),
  rows: z.array(z.object({ line: z.number().int().min(1).max(100_000), raw: z.record(z.string().max(60), z.string().max(1000)) })).min(1).max(IMPORT_CHUNK * 4),
});

/**
 * Import employees or subcontractors from a spreadsheet, one chunk at a time (the page sends 25 rows per call).
 * dryRun only reports which rows match people already in Built2Bid. Every row is validated again here, and each
 * write runs as the signed-in user through the same database checks as the screens.
 */
export async function POST(req: Request) {
  const g = await guardWrite("team-import", 400);
  if (!g.ok) return g.res;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the file and try again.");
  if (!p.data.dryRun && p.data.rows.length > IMPORT_CHUNK) return fail(400, "invalid", `Send ${IMPORT_CHUNK} rows at a time.`);
  try {
    const results = await runImport(g.supabase, g.userId, p.data.kind, p.data.rows, p.data.dryRun);
    return json({ results });
  } catch (e) {
    const err = e as { message?: string; code?: string };
    if (err && typeof err === "object" && ("code" in err || "message" in err) && !(e instanceof Error)) return dbFail("team.import", err);
    logError("team.import", e);
    return fail(500, "server_error", "The import stopped. Rows already imported were kept; try the rest again.");
  }
}
