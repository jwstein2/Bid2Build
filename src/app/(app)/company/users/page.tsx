import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import { Notice } from "@/components/ui/misc";
import { UsersManager, type Invite, type Member, type Team } from "@/components/company/users-manager";

export const metadata: Metadata = { title: "Users & Permissions", robots: { index: false } };

export default async function CompanyUsersPage() {
  const supabase = await createClient();
  const company = await loadMyCompany(supabase);
  if (!company) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-extrabold">Users & Permissions</h1>
        <Notice title="No company account">Users & Permissions is part of Enterprise.</Notice>
      </div>
    );
  }
  const manageUsers = can(company, "manage_users");
  const [{ data: roster }, { data: teams }, invites, access] = await Promise.all([
    supabase.rpc("company_roster"),
    supabase.rpc("company_teams_overview"),
    manageUsers ? supabase.rpc("list_company_invitations").then((r) => r.data) : Promise.resolve([]),
    manageUsers ? supabase.rpc("company_member_access").then((r) => r.data) : Promise.resolve([]),
  ]);
  type Access = { user_id: string; permissions_granted: string[]; permissions_revoked: string[] };
  const accessById = new Map(((access ?? []) as Access[]).map((a) => [a.user_id, a]));
  const members = ((roster ?? []) as Member[]).map((m) => ({ ...m, ...accessById.get(m.user_id) }));
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Users & Permissions</h1>
        <p className="text-ink-soft">{company.name}</p>
      </div>
      <UsersManager
        me={user?.id ?? ""}
        myPermissions={company.permissions}
        isOwner={company.isOwner}
        seats={{ used: company.seatsUsed, limit: company.entitlement.seatLimit, active: company.entitlement.active }}
        canBuySeats={can(company, "manage_billing") && company.entitlement.source === "stripe"}
        members={members}
        teams={(teams ?? []) as Team[]}
        invites={(invites ?? []) as Invite[]}
      />
    </div>
  );
}
