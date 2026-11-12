import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Builder } from "@/components/builder/builder";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadBusiness, loadEstimate } from "@/lib/data/server";

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
  const { business, exists } = await loadBusiness(supabase, user.id);
  return (
    <Builder
      initialEstimate={data.estimate}
      initialConfig={data.proposalConfig}
      initialBusiness={exists ? business : null}
      mode="cloud"
      user={user}
      initialStep={!exists || !business.companyName ? "company" : sp.step === "proposal" ? "proposal" : "estimate"}
      autoExport={sp.export === "1"}
    />
  );
}
