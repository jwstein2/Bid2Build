import { createAdminClient } from "@/lib/supabase/server";
import { rowToBusiness } from "@/lib/data/mappers";

type Row = Record<string, unknown>;
type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export interface PdfBranding {
  company: { name: string; phone?: string; email?: string; address?: string; website?: string; license?: string; color?: string };
  logo: { data: Buffer; format: "png" } | null;
  /** Practice-sandbox book: documents carry a "not a real document" watermark. */
  sandbox: boolean;
}

/**
 * Public company branding for customer / vendor documents (name, contact, licence, colour, logo) of the
 * book's owner. The book row is read with the caller's RLS client; only the owner's public business profile
 * and logo come from the admin client. A sandbox book borrows the branding of the real book it practises for.
 */
export async function loadBranding(db: Db, bookId: string, opts: { logo?: boolean } = {}): Promise<PdfBranding> {
  const { data: book } = await db.from("fin_books").select("company_id, owner_user_id, sandbox_of").eq("id", bookId).maybeSingle();
  const admin = createAdminClient();
  const sandbox = Boolean((book as Row | null)?.sandbox_of);
  const { data: live } = sandbox ? await admin.from("fin_books").select("company_id, owner_user_id").eq("id", s((book as Row).sandbox_of)).maybeSingle() : { data: book };
  const b = live as Row | null;
  let ownerId = s(b?.owner_user_id);
  if (!ownerId && b?.company_id) {
    const { data: co } = await admin.from("companies").select("owner_user_id").eq("id", s(b.company_id)).maybeSingle();
    ownerId = s((co as Row | null)?.owner_user_id);
  }
  const { data: bizRow } = ownerId ? await admin.from("business_profiles").select("*").eq("user_id", ownerId).maybeSingle() : { data: null };
  const biz = rowToBusiness(bizRow);
  let logo: PdfBranding["logo"] = null;
  if (biz.logoPath && opts.logo !== false) {
    const { data: file } = await admin.storage.from("logos").download(biz.logoPath);
    if (file) logo = { data: Buffer.from(await file.arrayBuffer()), format: "png" };
  }
  return {
    company: { name: biz.companyName || "Your contractor", phone: biz.phone, email: biz.email, address: biz.address, website: biz.website, license: biz.licenseNumber, color: biz.primaryColor },
    logo,
    sandbox,
  };
}
