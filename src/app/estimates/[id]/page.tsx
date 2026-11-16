import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Builder } from "@/components/builder/builder";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadBusiness, loadEstimate } from "@/lib/data/server";
import { loadCreditStatus } from "@/lib/credits/server";
import { isBuilderStep } from "@/lib/estimate/workflow";
import { AccountThemeScript } from "@/components/theme/account-theme-script";

export const metadata: Metadata = { title: "Edit Bid", robots: { index: false } };

export default async function EstimatePage({ params, searchParams }: PageProps<"/estimates/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect(`/login?next=/estimates/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const data = await loadEstimate(supabase, id);
  if (!data) notFound();
  // Credits load with the page (same query as /api/credits) so the builder header doesn't change
  // size after it appears.
  const [{ business, exists }, credits] = await Promise.all([loadBusiness(supabase, user.id), loadCreditStatus(supabase)]);
  return (
    <>
    <AccountThemeScript pref={user.theme} />
    <Builder
      initialEstimate={data.estimate}
      initialConfig={data.proposalConfig}
      initialBusiness={exists ? business : null}
      mode="cloud"
      user={user}
      initialStep={isBuilderStep(sp.step) ? sp.step : undefined}
      autoExport={sp.export === "1"}
      initialCredits={credits}
    />
    </>
  );
}
