import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import { Notice } from "@/components/ui/misc";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProposalStyleEditor, type CompanyStyleData } from "@/components/company/proposal-style-editor";
import { loadOwnerBusiness } from "@/lib/operations/style-server";

export const metadata: Metadata = { title: "Proposal & Bid Style", robots: { index: false } };

export default async function ProposalStylePage() {
  const supabase = await createClient();
  const company = await loadMyCompany(supabase);
  const crumbs = <Breadcrumbs className="mb-3" items={[{ label: "Company", href: "/company/users" }, { label: "Proposal & Bid Style" }]} />;
  if (!company || !can(company, "view_proposal_style")) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">{crumbs}
        <h1 className="text-3xl font-extrabold">Proposal &amp; Bid Style</h1>
        <Notice title="Not part of your access">{company ? "Ask your company owner for “View company proposal style”." : <>Company proposal style is part of the Team plan. <Link href="/pricing#enterprise" className="underline">See Team</Link>.</>}</Notice>
      </div>
    );
  }
  const [{ data, error }, { data: owner }, { data: people }] = await Promise.all([
    supabase.rpc("company_proposal_style"),
    supabase.from("companies").select("owner_user_id").eq("id", company.id).maybeSingle(),
    supabase.rpc("pm_people"),
  ]);
  if (error || !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">{crumbs}
        <h1 className="text-3xl font-extrabold">Proposal &amp; Bid Style</h1>
        <Notice title="Not available yet">Company proposal style turns on after the V4.4 database update is installed.</Notice>
      </div>
    );
  }
  // Company branding previews the owner's profile: every member may see it on company bids anyway.
  const ownerBusiness = owner?.owner_user_id ? await loadOwnerBusiness(createAdminClient(), owner.owner_user_id as string, { signedLogo: true }) : null;
  const names = Object.fromEntries(((people as { id: string; name: string }[] | null) ?? []).map((p) => [p.id, p.name]));
  return (
    <div className="mx-auto max-w-7xl space-y-4" data-guide-page="company.proposal-style">
      {crumbs}
      <div>
        <h1 className="text-3xl font-extrabold">Proposal &amp; Bid Style</h1>
        <p className="text-ink-soft">One look for every {company.name} proposal. The company owner has final say, including what&apos;s locked.</p>
      </div>
      <ProposalStyleEditor initial={data as CompanyStyleData} ownerBusiness={ownerBusiness} people={names} />
    </div>
  );
}
