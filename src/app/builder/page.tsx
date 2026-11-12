import type { Metadata } from "next";
import { getUser, createClient } from "@/lib/supabase/server";
import { loadBusiness } from "@/lib/data/server";
import { BuilderLoader } from "./loader";

export const metadata: Metadata = { title: "Bid Builder", robots: { index: false } };

export default async function BuilderPage({ searchParams }: PageProps<"/builder">) {
  const sp = await searchParams;
  const user = await getUser();
  let business = null;
  if (user) business = (await loadBusiness(await createClient(), user.id)).business;
  return <BuilderLoader draftId={typeof sp.draft === "string" ? sp.draft : null} user={user} business={business} autoExport={sp.export === "1"} />;
}
