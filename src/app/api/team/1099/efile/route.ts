import { fail, logError } from "@/lib/http/api";
import { formatTaxId, openPii, piiReady } from "@/lib/security/pii";
import { load1099, sealedTins } from "@/lib/team/nec-1099";
import { dbFail, guardWrite } from "@/lib/team/route-helpers";
import { necCsv, type Nec1099Row } from "@/lib/team/sub-requests";

export const runtime = "nodejs";

/**
 * 1099-NEC e-file CSV for ?year: one row per sub that needs a form, with the full TIN. Only people who can see
 * full tax IDs get it, and each TIN included is logged as exported. Rows without a full TIN on file are left
 * blank in that column so they can't be filed by mistake.
 */
export async function GET(req: Request) {
  const g = await guardWrite("sub-1099-efile", 10);
  if (!g.ok) return g.res;
  const year = Number(new URL(req.url).searchParams.get("year") ?? "");
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return fail(400, "invalid", "Pick a year.");
  if (!piiReady()) return fail(503, "pii_off", "The e-file export turns on once the encryption key is set.");
  const r = await load1099(g.supabase, year);
  if ("error" in r) return dbFail("subs.1099.efile", r.error);
  if (!r.payer?.ein) return fail(409, "payer_missing", "Add your legal name and EIN (payer details) first.");
  const ids = r.rows.map((x) => x.resourceId).filter((x): x is string => !!x);
  for (const id of ids) {
    const { error } = await g.supabase.rpc("pm_sensitive_log", { p_resource_id: id, p_kind: "tin", p_action: "exported", p_note: `1099-NEC ${year} e-file export` });
    if (error) return dbFail("subs.1099.efile.log", error);
  }
  const sealed = await sealedTins(ids);
  const rows: Nec1099Row[] = r.rows.map((x) => {
    let tin: string | null = null;
    const s = x.resourceId ? sealed.get(x.resourceId) : undefined;
    if (s) { try { tin = formatTaxId(openPii(s), x.tinType === "ssn" ? "ssn" : "ein"); } catch (e) { logError("subs.1099.efile.open", e); } }
    return { recipientName: x.legalName ?? x.vendorName, businessName: x.businessName, tinType: x.tinType, tin, address: x.address, amount: x.paid.toFixed(2) };
  });
  return new Response(necCsv(year, r.payer, rows), { headers: {
    "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="1099-nec-${year}-efile.csv"`,
    "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer",
  } });
}
