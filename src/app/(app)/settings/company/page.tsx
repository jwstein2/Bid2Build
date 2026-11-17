import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadBusiness } from "@/lib/data/server";
import { CompanyEditor } from "./editor";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";

export const metadata: Metadata = { title: "Company profile", robots: { index: false } };

export default async function CompanyPage() {
  const user = await getUser();
  // The layout redirects too, but pages render in parallel with it: never assume a session here.
  if (!user) redirect("/login?next=/settings/company");
  const { business } = await loadBusiness(await createClient(), user.id);
  return (
    <>
      {isContractorSigningEnabled() && (
        <p className="mx-auto mb-2 max-w-3xl text-sm" data-testid="proposal-signing-link"><Link href="/settings/company/signing" className="font-semibold text-accent-ink underline">Proposal signing</Link> <span className="text-muted">· who signs accepted proposals for your company.</span></p>
      )}
      <p className="mx-auto mb-2 max-w-3xl text-sm"><Link href="/welcome" className="font-semibold text-accent-ink underline">Set up from my website</Link> <span className="text-muted">· we find your logo, colors and details, and you approve each one.</span></p>
      <CompanyEditor initial={business} />
    </>
  );
}
