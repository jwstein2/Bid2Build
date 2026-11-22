import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit, sameOrigin } from "@/lib/http/api";
import { classifyRows, CUSTOMER_IMPORT_CHUNK, MAX_CUSTOMER_ROWS, type ExistingCustomer, type RowStatus } from "@/lib/customers/import";

export const runtime = "nodejs";
export const maxDuration = 26;

const row = z.object({
  name: z.string().trim().min(1).max(200),
  companyName: z.string().trim().max(200).optional(),
  customerType: z.enum(["person", "business"]),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  projectAddress: z.string().trim().max(500).optional(),
  notes: z.string().max(4000).optional(),
});
const body = z.object({
  dryRun: z.boolean().default(false),
  allowNameOnly: z.boolean().default(false),
  rows: z.array(z.object({ line: z.number().int().min(1).max(1_000_000), row })).min(1).max(MAX_CUSTOMER_ROWS),
});

type Db = Awaited<ReturnType<typeof createClient>>;

/** Every customer the caller can see (their own, and their company's through RLS), for duplicate checks. */
async function existingCustomers(db: Db): Promise<ExistingCustomer[]> {
  const out: ExistingCustomer[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 50_000; from += PAGE) {
    let res = await db.from("customers").select("name, email, phone, company_name").order("created_at").range(from, from + PAGE - 1);
    if (res.error && /company_name/.test(res.error.message)) res = await db.from("customers").select("name, email, phone").order("created_at").range(from, from + PAGE - 1) as typeof res;
    if (res.error) throw res.error;
    out.push(...((res.data ?? []) as ExistingCustomer[]));
    if (!res.data || res.data.length < PAGE) break;
  }
  return out;
}

/**
 * Customers → Import. dryRun classifies every row (new, or a duplicate of an existing customer / an earlier row) with
 * no writes. A real run sends up to 100 rows, re-checks duplicates against the database, and saves only new rows as
 * the signed-in user, so the same company stamping and RLS apply as Customers → New customer.
 */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await rateLimit(`customer-import:${user.id}`, 300, 10 * 60_000))) return fail(429, "rate_limited", "Please wait a moment and try again.");
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Check the file and try again.");
  if (!p.data.dryRun && p.data.rows.length > CUSTOMER_IMPORT_CHUNK) return fail(400, "invalid", `Send ${CUSTOMER_IMPORT_CHUNK} rows at a time.`);
  const db = await createClient();
  try {
    const statuses = classifyRows(p.data.rows, await existingCustomers(db), p.data.allowNameOnly);
    if (p.data.dryRun) return json({ results: statuses });
    const fresh = new Set(statuses.filter((s) => s.status === "new").map((s) => s.line));
    const toSave = p.data.rows.filter((r) => fresh.has(r.line));
    const results: (RowStatus | { line: number; status: "created" } | { line: number; status: "failed"; message: string })[] = statuses.filter((s) => s.status !== "new");
    if (toSave.length) {
      const base = (r: z.infer<typeof row>) => ({ user_id: user.id, name: r.name, email: r.email || null, phone: r.phone || null, project_address: r.projectAddress || null, notes: r.notes || null });
      let ins = await db.from("customers").insert(toSave.map(({ row: r }) => ({ ...base(r), customer_type: r.customerType, company_name: r.companyName || null }))).select("id");
      if (ins.error && /customer_type|company_name/.test(ins.error.message)) ins = await db.from("customers").insert(toSave.map(({ row: r }) => base(r))).select("id");
      if (ins.error) {
        logError("customers.import", ins.error);
        results.push(...toSave.map((r) => ({ line: r.line, status: "failed" as const, message: "Couldn't save this batch. Try the import again; customers already saved will be skipped." })));
      } else results.push(...toSave.map((r) => ({ line: r.line, status: "created" as const })));
    }
    return json({ results: results.sort((a, b) => a.line - b.line) });
  } catch (e) {
    logError("customers.import", e);
    return fail(500, "server_error", "The import stopped. Customers already saved were kept; run the import again to add the rest.");
  }
}
