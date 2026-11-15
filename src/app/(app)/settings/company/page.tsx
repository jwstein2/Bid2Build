import type { Metadata } from "next";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadBusiness } from "@/lib/data/server";
import { CompanyEditor } from "./editor";

export const metadata: Metadata = { title: "Company profile", robots: { index: false } };

export default async function CompanyPage() {
  const user = (await getUser())!;
  const { business } = await loadBusiness(await createClient(), user.id);
  return (
    <>
      <p className="mx-auto mb-2 max-w-3xl text-sm"><Link href="/welcome" className="font-semibold text-accent-ink underline">Set up from my website</Link> <span className="text-muted">· we find your logo, colors and details, and you approve each one.</span></p>
      <CompanyEditor initial={business} />
    </>
  );
}
