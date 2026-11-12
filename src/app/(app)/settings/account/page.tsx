import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui/misc";
import { AccountActions } from "./actions-client";
import { MarketSharing } from "./market-sharing";

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
      <Card className="p-5">
        <p className="text-sm text-muted">Sign-in email</p>
        <p className="font-semibold">{user.email}</p>
        <p className="mt-1 text-sm text-ink-soft">{user.emailVerified ? "Verified" : "Not verified yet: check your inbox."} You sign in with a one-time email link or code; there is no password to manage.</p>
      </Card>
      <MarketSharing initial={{ sharePrices: Boolean(consent?.share_prices), shareCosts: Boolean(consent?.share_costs), commercialUse: Boolean(consent?.commercial_use) }} />
      <AccountActions marketing={Boolean(profile?.marketing_opt_in)} />
    </div>
  );
}
