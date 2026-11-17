import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signingTenant } from "./server";

export interface SignerRow {
  userId: string; name: string; email: string | null; role: string; isOwner: boolean;
  authorization: { id: string; scope: "own_bids" | "company_bids"; autoApplyAllowed: boolean; title: string | null; grantedAt: string } | null;
  credential: { version: number; method: string; legalName: string; title: string | null; autoApplyAuthorized: boolean; adoptedAt: string } | null;
}
export interface SigningSettings {
  tenant: { companyId: string | null; companyName: string | null; isOwner: boolean; canManage: boolean; role: string | null };
  policy: { configured: boolean; required: boolean; mode: "company_signer" | "sales_rep" | "manual"; defaultSignerId: string | null; autoApplyAllowed: boolean; autoApplyTiming: "before_send" | "after_customer"; repSignaturesAllowed: boolean; revision: number | null; updatedAt: string | null };
  signers: SignerRow[];
  me: SignerRow["credential"];
  myAuthorization: SignerRow["authorization"];
  history: { revision: number; at: string; actor: string | null }[];
}

/** Everything the Proposal Signing page needs. Never includes signature images. */
export async function loadSigningSettings(admin: SupabaseClient, userId: string): Promise<SigningSettings> {
  const tenant = await signingTenant(admin, userId);
  const [{ data: policy }, { data: cred }, { data: myAuth }] = await Promise.all([
    admin.rpc("contractor_policy_for", { p_company: tenant.companyId, p_owner: userId }),
    admin.from("contractor_signer_credentials").select("version, method, legal_name, title, auto_apply_authorized, auto_apply_revoked_at, created_at").eq("user_id", userId).eq("status", "active").maybeSingle(),
    tenant.companyId
      ? admin.from("contractor_signing_authorizations").select("id, scope, auto_apply_allowed, title, granted_at").eq("company_id", tenant.companyId).eq("user_id", userId).eq("status", "active").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const me = cred ? { version: cred.version, method: cred.method, legalName: cred.legal_name, title: cred.title, autoApplyAuthorized: Boolean(cred.auto_apply_authorized && !cred.auto_apply_revoked_at), adoptedAt: cred.created_at } : null;
  let signers: SignerRow[] = [];
  if (tenant.companyId && tenant.canManage) {
    const { data } = await admin.rpc("contractor_company_signers", { p_actor: userId, p_company: tenant.companyId });
    signers = (data ?? []) as SignerRow[];
  } else if (!tenant.companyId) {
    signers = [{ userId, name: me?.legalName ?? "You", email: null, role: "owner", isOwner: true, authorization: null, credential: me }];
  }
  const p = (policy ?? {}) as Record<string, unknown>;
  let history: SigningSettings["history"] = [];
  if (p.id && tenant.canManage) {
    const { data: h } = await admin.from("contractor_signing_policy_history").select("revision, created_at, actor_id").eq("policy_id", p.id as string).order("revision", { ascending: false }).limit(10);
    history = (h ?? []).map((x) => ({ revision: x.revision, at: x.created_at, actor: x.actor_id }));
  }
  return {
    tenant: { companyId: tenant.companyId, companyName: tenant.companyName, isOwner: tenant.isOwner, canManage: tenant.canManage, role: tenant.role },
    policy: {
      configured: Boolean(p.configured), required: p.required !== false, mode: (p.mode as SigningSettings["policy"]["mode"]) ?? "manual",
      defaultSignerId: (p.defaultSignerId as string | null) ?? null, autoApplyAllowed: Boolean(p.autoApplyAllowed),
      autoApplyTiming: (p.autoApplyTiming as SigningSettings["policy"]["autoApplyTiming"]) ?? "before_send", repSignaturesAllowed: Boolean(p.repSignaturesAllowed),
      revision: (p.revision as number | null) ?? null, updatedAt: (p.updatedAt as string | null) ?? null,
    },
    signers,
    me,
    myAuthorization: myAuth ? { id: myAuth.id, scope: myAuth.scope, autoApplyAllowed: myAuth.auto_apply_allowed, title: myAuth.title, grantedAt: myAuth.granted_at } : null,
    history,
  };
}
