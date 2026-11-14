import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadBusiness } from "@/lib/data/server";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { proposalConfigFrom } from "@/lib/data/mappers";
import { DefaultsEditor } from "./editor";
import { PremiumDiamond } from "@/components/billing/premium";

export const metadata: Metadata = { title: "Proposal Templates", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard/templates");
  const supabase = await createClient();
  const [{ business }, { data: row }, unlimited] = await Promise.all([
    loadBusiness(supabase, user.id),
    supabase.from("business_profiles").select("default_proposal_config").eq("user_id", user.id).maybeSingle(),
    hasPremiumAccess(supabase),
  ]);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-extrabold">Proposal Templates <PremiumDiamond className="[&_svg]:h-5 [&_svg]:w-5" /></h1>
        <p className="mt-1 text-ink-soft">Choose your default style, wording, and payment schedule. New bids start with these settings; you can still change anything per bid.</p>
      </div>
      <DefaultsEditor business={business} initial={proposalConfigFrom(row?.default_proposal_config)} unlimited={unlimited} />
    </div>
  );
}
