import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { fail, logError } from "@/lib/http/api";
import { load1099 } from "@/lib/team/nec-1099";
import { NecCopyBPdf, type NecCopyB } from "@/lib/pdf/nec-copy-b";
import { dbFail, guardRead, UUID_RE } from "@/lib/team/route-helpers";

export const runtime = "nodejs";

/** Recipient copies (Copy B) for ?year, all subs or one (?resource=). Uses only the last 4 of the TIN. */
export async function GET(req: Request) {
  const g = await guardRead();
  if (!g.ok) return g.res;
  const u = new URL(req.url);
  const year = Number(u.searchParams.get("year") ?? "");
  const one = u.searchParams.get("resource");
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return fail(400, "invalid", "Pick a year.");
  if (one && !UUID_RE.test(one)) return fail(400, "invalid", "Pick a subcontractor.");
  const r = await load1099(g.supabase, year);
  if ("error" in r) return dbFail("subs.1099.copyb", r.error);
  if (!r.payer?.ein) return fail(409, "payer_missing", "Add your legal name and EIN (payer details) first.");
  const rows = r.rows.filter((x) => !one || x.resourceId === one);
  if (!rows.length) return fail(404, "not_found", "No one needs a 1099-NEC for that year.");
  const payer = { legalName: r.payer.legalName, ein: r.payer.ein, address: r.payer.address, phone: r.payer.phone };
  const forms: NecCopyB[] = rows.map((x) => ({ year, payer, recipient: {
    name: x.legalName ?? x.vendorName, businessName: x.businessName, tinType: x.tinType, tinLast4: x.tinLast4, address: x.address, amount: x.paid.toFixed(2), account: x.vendorId.slice(0, 8).toUpperCase(),
  } }));
  let pdf: Buffer;
  try { pdf = await renderToBuffer(createElement(NecCopyBPdf, { forms }) as React.ReactElement<DocumentProps>); }
  catch (e) { logError("subs.1099.copyb.render", e); return fail(500, "pdf_failed", "We couldn't make the PDF. Please try again."); }
  return new Response(new Uint8Array(pdf), { headers: {
    "content-type": "application/pdf", "content-disposition": `attachment; filename="1099-nec-${year}-copy-b.pdf"`,
    "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer",
  } });
}
