import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { loadBusiness } from "@/lib/data/server";
import { WelcomeWizard, type ExistingBrand } from "./wizard";

export const metadata: Metadata = { title: "Welcome to Built2Bid", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * First-login setup for gifted members (also reachable any time from Company profile: "Set up from my website").
 * The member is a Built2Bid customer first: this sets up THEIR company; nothing about it is creator-branded.
 */
export default async function Welcome() {
  if (!isSupabaseConfigured()) redirect("/");
  const user = await getUser();
  if (!user) redirect("/login?next=/welcome");
  const supabase = await createClient();
  const [{ business, exists }, { data: bp }, { data: mentorship }] = await Promise.all([
    loadBusiness(supabase, user.id),
    supabase.from("business_profiles").select("primary_trade").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("my_mentorship"),
  ]);
  const gift = (Array.isArray(mentorship) ? mentorship : []).find((m: { state: string }) => m.state === "active") as { expires_at: string; workspace_name: string } | undefined;
  const existing: ExistingBrand = exists ? {
    companyName: business.companyName || null, tagline: business.tagline || null, primaryColor: business.primaryColor, secondaryColor: business.secondaryColor,
    email: business.email || null, phone: business.phone || null, address: business.address || null, website: business.website || null,
    licenseNumber: business.licenseNumber || null, trade: (bp?.primary_trade as string | null) ?? null, services: business.description || null, logoUrl: business.logoUrl ?? null,
  } : null;
  return <WelcomeWizard existing={existing} giftUntil={gift?.expires_at ?? null} />;
}
