import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { getUser } from "@/lib/supabase/server";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { ProposalSigning } from "./proposal-signing";

export const metadata: Metadata = { title: "Proposal signing", robots: { index: false } };

/** Company Profile → Proposal Signing. */
export default async function ProposalSigningPage() {
  if (!isContractorSigningEnabled()) notFound();
  const user = await getUser();
  if (!user) redirect("/login?next=/settings/company/signing");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Breadcrumbs items={[{ label: "Company profile", href: "/settings/company" }, { label: "Proposal signing" }]} />
      <div>
        <h1 className="text-3xl font-extrabold">Proposal signing</h1>
        <p className="mt-1 text-ink-soft">Who signs accepted proposals for your company, and when. A contract is only marked Fully Executed once the contractor signature it needs is actually recorded.</p>
      </div>
      <ProposalSigning />
    </div>
  );
}
