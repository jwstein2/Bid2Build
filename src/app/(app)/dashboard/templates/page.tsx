import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadBusiness } from "@/lib/data/server";
import { proposalConfigFrom } from "@/lib/data/mappers";
import { DefaultsEditor } from "./editor";

export const metadata: Metadata = { title: "Proposal templates", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard/templates");
  const supabase = await createClient();
  const [{ business }, { data: row }, { data: q }] = await Promise.all([
    loadBusiness(supabase, user.id),
    supabase.from("business_profiles").select("default_proposal_config").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("credit_status"),
  ]);
  const unlimited = Boolean((Array.isArray(q) ? q[0] : q)?.unlimited);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Proposal templates</h1>
        <p className="mt-1 text-ink-soft">Choose your default style, wording, and payment schedule. New bids start with these settings; you can still change anything per bid.</p>
      </div>
      <DefaultsEditor business={business} initial={proposalConfigFrom(row?.default_proposal_config)} unlimited={unlimited} />
    </div>
  );
}
