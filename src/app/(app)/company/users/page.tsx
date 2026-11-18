import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import { isFinancialsEnabled, isPmEnabled } from "@/lib/env";
import { parseProfile, type AccessPolicy } from "@/lib/access/effective";
import { loadWorkspaceRaw } from "@/lib/access/server";
import { AccessPolicyCard, type AccessLicenses, type AccessMember } from "@/components/company/access-editor";
import type { FinRole } from "@/lib/financials/permissions";
import { loadSeatCard } from "@/lib/pm/server";
import { PmEditorsCard } from "@/components/company/pm-editors";
import { Notice } from "@/components/ui/misc";
import { UsersManager, type Invite, type Member, type Team, type WorkspaceAccessData } from "@/components/company/users-manager";

export const metadata: Metadata = { title: "Team & Access", robots: { index: false } };

type OverviewMember = { userId: string; role: Member["role"]; granted: string[]; revoked: string[]; policyRevoked: string[]; profile: unknown; pmEditor: boolean; pmEditorAssigned: boolean; finRole: FinRole | null; finCovered: boolean; finAccountantSeat: boolean };
type Overview = { policy: AccessPolicy; licenses: AccessLicenses; members: OverviewMember[] };

export default async function CompanyUsersPage() {
  const supabase = await createClient();
  const company = await loadMyCompany(supabase);
  if (!company) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-extrabold">Team & Access</h1>
        <Notice title="No company account">Team & Access is part of the Team plan.</Notice>
      </div>
    );
  }
  const manageUsers = can(company, "manage_users");
  const [{ data: roster }, { data: teams }, invites, access, overview, raw] = await Promise.all([
    supabase.rpc("company_roster"),
    supabase.rpc("company_teams_overview"),
    manageUsers ? supabase.rpc("list_company_invitations").then((r) => r.data) : Promise.resolve([]),
    manageUsers ? supabase.rpc("company_member_access").then((r) => r.data) : Promise.resolve([]),
    // V6.7: null until 20261222001000_workspace_access.sql is applied (the older editor stays until then).
    manageUsers ? supabase.rpc("company_access_overview").then((r) => (r.error ? null : (r.data as Overview))) : Promise.resolve(null),
    loadWorkspaceRaw(supabase).catch(() => null),
  ]);
  type Access = { user_id: string; permissions_granted: string[]; permissions_revoked: string[] };
  const accessById = new Map(((access ?? []) as Access[]).map((a) => [a.user_id, a]));
  const members = ((roster ?? []) as Member[]).map((m) => ({ ...m, ...accessById.get(m.user_id) }));
  const { data: { user } } = await supabase.auth.getUser();
  const nameOf = (id: string) => { const m = members.find((x) => x.user_id === id); return m?.display_name || m?.email || "Team member"; };
  const workspaceAccess: WorkspaceAccessData | null = overview ? {
    members: Object.fromEntries(overview.members.map((m) => [m.userId, {
      userId: m.userId, name: nameOf(m.userId), role: m.role, granted: m.granted ?? [], revoked: m.revoked ?? [], policyRevoked: m.policyRevoked ?? [],
      profile: parseProfile(m.profile), pmEditor: m.pmEditor, pmEditorAssigned: m.pmEditorAssigned, finRole: m.finRole, finCovered: m.finCovered, finAccountantSeat: m.finAccountantSeat,
    } satisfies AccessMember])),
    licenses: overview.licenses, policy: { denied: overview.policy.denied ?? [], locked: overview.policy.locked ?? [] },
    premium: raw?.premium ?? company.entitlement.active, actorPerms: company.permissions,
    flags: { pm: isPmEnabled(), financials: isFinancialsEnabled() },
  } : null;
  // Scheduling editor seats (V4 Phase 9): anyone with "Manage scheduling editor seats" can assign and reassign
  // here; buying more seats stays on Billing (owner).
  const seatCard = isPmEnabled() && company.entitlement.active && can(company, "manage_pm_seats") ? await loadSeatCard(supabase, 0) : null;
  return (
    <div className="mx-auto max-w-5xl space-y-6" data-guide-page="company.users">
      <div>
        <h1 className="text-3xl font-extrabold">Team & Access</h1>
        <p className="text-ink-soft">{company.name}{workspaceAccess && " · Use Manage Access to choose which workspaces and features each person can use."}</p>
      </div>
      {workspaceAccess && company.isOwner && <AccessPolicyCard policy={workspaceAccess.policy} />}
      <UsersManager
        me={user?.id ?? ""}
        myPermissions={company.permissions}
        isOwner={company.isOwner}
        seats={{ used: company.seatsUsed, limit: company.entitlement.seatLimit, active: company.entitlement.active }}
        canBuySeats={can(company, "manage_billing") && company.entitlement.source === "stripe"}
        members={members}
        teams={(teams ?? []) as Team[]}
        invites={(invites ?? []) as Invite[]}
        access={workspaceAccess}
      />
      {seatCard && <PmEditorsCard seats={seatCard.seats} members={seatCard.members} extra={seatCard.seats.extraPaid} canManage canBuy={false}
        comp={company.entitlement.source === "complimentary"} billingHref={can(company, "manage_pm_addons") ? "/company/billing" : undefined} />}
    </div>
  );
}
