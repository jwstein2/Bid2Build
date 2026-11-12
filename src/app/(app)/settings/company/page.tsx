import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadBusiness } from "@/lib/data/server";
import { CompanyEditor } from "./editor";

export const metadata: Metadata = { title: "Company profile", robots: { index: false } };

export default async function CompanyPage() {
  const user = (await getUser())!;
  const { business } = await loadBusiness(await createClient(), user.id);
  return <CompanyEditor initial={business} />;
}
