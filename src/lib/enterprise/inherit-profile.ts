/**
 * V4.3 #10: a person who joins a company through an Enterprise invitation starts with the company's
 * business profile (name, phone, address, website, license, branding, logo) so their first bid looks
 * like the company's. Only BLANK fields are filled: anything they already set is kept. Their own
 * email stays theirs (their sign-in email, never the owner's), and so does their contact name.
 */
type Row = Record<string, unknown>;
const INHERITED = ["company_name", "phone", "address", "website", "license_number", "tagline", "description", "primary_trade"] as const;
const BRANDING = ["primary_color", "secondary_color", "logo_layout", "header_style"] as const;
const DEFAULTS: Record<(typeof BRANDING)[number], string> = { primary_color: "#1f3a5f", secondary_color: "#c8702a", logo_layout: "left", header_style: "solid" };
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());

/** The changes to apply to the joining member's profile (empty object = nothing to change). */
export function inheritedProfilePatch(own: Row | null, owner: Row | null, ownEmail: string | null): Row {
  const patch: Row = {};
  if (!owner) return patch;
  const mine = own ?? {};
  for (const k of INHERITED) if (blank(mine[k]) && !blank(owner[k])) patch[k] = owner[k];
  // Branding columns have defaults, so "blank" means still on the platform default.
  for (const k of BRANDING) if ((blank(mine[k]) || mine[k] === DEFAULTS[k]) && !blank(owner[k]) && owner[k] !== DEFAULTS[k]) patch[k] = owner[k];
  if (blank(mine.email) && ownEmail) patch.email = ownEmail;
  return patch;
}

/** Apply the inheritance with the service role (called only after the database accepted the invitation). */
export async function inheritCompanyProfile(
  admin: { from: (t: string) => any; storage: { from: (b: string) => any } }, // eslint-disable-line @typescript-eslint/no-explicit-any
  p: { companyId: string; userId: string; email: string | null },
) {
  const { data: company } = await admin.from("companies").select("owner_user_id").eq("id", p.companyId).maybeSingle();
  const ownerId = company?.owner_user_id as string | undefined;
  if (!ownerId || ownerId === p.userId) return { changed: [] as string[] };
  const [{ data: owner }, { data: own }] = await Promise.all([
    admin.from("business_profiles").select("*").eq("user_id", ownerId).maybeSingle(),
    admin.from("business_profiles").select("*").eq("user_id", p.userId).maybeSingle(),
  ]);
  const patch = inheritedProfilePatch(own as Row | null, owner as Row | null, p.email);
  // The logo is copied into the member's own folder, so the company changing its logo later never
  // breaks (or silently changes) a member's saved proposals.
  if (owner?.logo_path && blank((own as Row | null)?.logo_path)) {
    const dest = `${p.userId}/logo-${Date.now()}.png`;
    const { error } = await admin.storage.from("logos").copy(owner.logo_path as string, dest);
    if (!error) patch.logo_path = dest;
  }
  if (!Object.keys(patch).length) return { changed: [] as string[] };
  await admin.from("business_profiles").upsert({ user_id: p.userId, ...patch }, { onConflict: "user_id" });
  return { changed: Object.keys(patch) };
}
