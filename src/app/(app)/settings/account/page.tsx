import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { AccountActions } from "./actions-client";
import { MarketSharing } from "./market-sharing";
import { SignInMethods } from "./sign-in-methods";
import { isSmsSignInEnabled } from "@/lib/auth/phone";

export const metadata: Metadata = { title: "Account settings", robots: { index: false } };

export default async function AccountPage() {
  const user = (await getUser())!;
  const supabase = await createClient();
  const [{ data: profile }, { data: consent }] = await Promise.all([
    supabase.from("profiles").select("marketing_opt_in").eq("id", user.id).maybeSingle(),
    supabase.from("market_consent").select("share_prices, share_costs, commercial_use").eq("user_id", user.id).maybeSingle(),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-extrabold">Account settings</h1>
      <SignInMethods email={user.email} emailVerified={user.emailVerified} phone={user.phone} phoneVerified={user.phoneVerified} smsEnabled={isSmsSignInEnabled()} />
      <MarketSharing initial={{ sharePrices: Boolean(consent?.share_prices), shareCosts: Boolean(consent?.share_costs), commercialUse: Boolean(consent?.commercial_use) }} />
      <AccountActions marketing={Boolean(profile?.marketing_opt_in)} />
    </div>
  );
}
