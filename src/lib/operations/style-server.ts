import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToBusiness } from "@/lib/data/mappers";
import type { Estimate } from "@/lib/estimate/types";
import type { BusinessProfile, ProposalConfig } from "@/lib/proposal/types";
import { resolveProposalStyle, type ResolvedStyle, type StylePolicy } from "./proposal-style";
import { missingMigration } from "./server";

/** The style policy for one bid (null before the V4.4 SQL runs, or when the caller can't read the bid). */
export async function loadStylePolicy(supabase: SupabaseClient, estimateId: string): Promise<StylePolicy | null> {
  const { data, error } = await supabase.rpc("proposal_style_policy", { p_estimate_id: estimateId });
  if (error) { if (!missingMigration(error)) console.error(JSON.stringify({ level: "error", scope: "style.policy", code: error.code })); return null; }
  return (data as StylePolicy | null) ?? null;
}

/**
 * The company owner's business profile, for company branding. Read with the service role ONLY after
 * the caller proved they can read the bid (loadStylePolicy returned a managed policy for it).
 */
export async function loadOwnerBusiness(admin: SupabaseClient, ownerId: string, opts: { signedLogo?: boolean } = {}) {
  const { data } = await admin.from("business_profiles").select("*").eq("user_id", ownerId).maybeSingle();
  if (!data) return null;
  const b = rowToBusiness(data);
  if (opts.signedLogo && b.logoPath) {
    const { data: signed } = await admin.storage.from("logos").createSignedUrl(b.logoPath, 3600);
    b.logoUrl = signed?.signedUrl ?? null;
  }
  return b;
}

/** Resolve the company style for a bid on the server (preview data and every generated version). */
export async function applyCompanyStyle(args: {
  supabase: SupabaseClient; admin: SupabaseClient | null; estimateId: string;
  estimate: Estimate; business: BusinessProfile & { logoPath?: string | null }; config: ProposalConfig; signedLogo?: boolean;
}): Promise<ResolvedStyle & { policy: StylePolicy | null; business: BusinessProfile & { logoPath?: string | null } }> {
  const policy = await loadStylePolicy(args.supabase, args.estimateId);
  let ownerBusiness: (BusinessProfile & { logoPath?: string | null }) | null = null;
  if (policy?.managed && policy.style && (policy.style as { companyBranding?: boolean }).companyBranding && policy.companyOwnerId && args.admin) {
    ownerBusiness = await loadOwnerBusiness(args.admin, policy.companyOwnerId, { signedLogo: args.signedLogo });
  }
  const r = resolveProposalStyle({ policy, estimate: args.estimate, business: args.business, config: args.config, ownerBusiness });
  const config = r.stamp.managed ? ({ ...r.config, companyStyle: r.stamp } as ProposalConfig) : r.config;
  return { ...r, config, policy, business: r.business as BusinessProfile & { logoPath?: string | null } };
}
