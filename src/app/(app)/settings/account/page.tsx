import { isFinancialsEnabled } from "@/lib/env";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { AccountActions } from "./actions-client";
import { MarketSharing } from "./market-sharing";
import { SignInMethods } from "./sign-in-methods";
import { TwoStepSignIn } from "./two-step";
import { isSmsSignInEnabled } from "@/lib/auth/phone";
import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { DemoEnterButton } from "@/components/demo/demo-controls";
import { isPracticeEnabled } from "@/lib/demo/server";
import { LandingPreference } from "./landing-pref";
import { hasSales, NO_WORKSPACES } from "@/lib/workspaces";
import { loadWorkspaces } from "@/lib/workspaces-server";

export const metadata: Metadata = { title: "Account settings", robots: { index: false } };

export default async function AccountPage() {
  const user = await getUser();
  // The layout redirects too, but pages render in parallel with it: never assume a session here.
  if (!user) redirect("/login?next=/settings/account");
  const supabase = await createClient();
  const [{ data: profile }, { data: consent }, { data: isAdmin }, workspaces] = await Promise.all([
    supabase.from("profiles").select("marketing_opt_in").eq("id", user.id).maybeSingle(),
    supabase.from("market_consent").select("share_prices, share_costs, commercial_use").eq("user_id", user.id).maybeSingle(),
    // Owner check by immutable user id through the existing admin process; the enter route checks again.
    user.demo ? Promise.resolve({ data: false }) : supabase.rpc("is_admin", { p_user_id: user.id }),
    loadWorkspaces().catch(() => NO_WORKSPACES),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-guide-page="settings.account">
      <h1 className="text-3xl font-extrabold">Account settings</h1>
      <div data-guide="account.signin"><SignInMethods email={user.email} emailVerified={user.emailVerified} phone={user.phone} phoneVerified={user.phoneVerified} smsEnabled={isSmsSignInEnabled()} /></div>
      <TwoStepSignIn />
      {hasSales(workspaces) && <LandingPreference ws={workspaces} />}
      {!user.demo && (isAdmin === true || isPracticeEnabled()) && (
        <Card className="p-5" data-testid="demo-settings-card">
          <h2 className="font-bold">{isAdmin === true ? "Demo Mode" : "Practice Mode"}</h2>
          <p className="text-sm text-ink-soft">
            {isAdmin === true
              ? "Show Built2Bid with a fully populated sample company. It opens in a separate demo workspace: your real customers, bids, billing and settings are never changed, and nothing in the demo reaches a real person or payment system."
              : "Try Built2Bid with sample customers and a sample estimate in a separate practice workspace. Your real account stays exactly as it is."}
          </p>
          <DemoEnterButton kind={isAdmin === true ? "owner_demo" : "practice"} className="mt-3" variant="primary" />
        </Card>
      )}
      {isContractorSigningEnabled() && (
        <Card className="p-5" data-testid="my-signature-link">
          <h2 className="font-bold">My signature</h2>
          <p className="text-sm text-ink-soft">Draw, upload or type the signature you use on proposals and contracts, and review your signing authorization.</p>
          <Link href="/settings/account/signature" className="mt-2 inline-block font-semibold text-accent-ink underline">Manage my signature</Link>
        </Card>
      )}
      <div data-guide="account.sharing"><MarketSharing initial={{ sharePrices: Boolean(consent?.share_prices), shareCosts: Boolean(consent?.share_costs), commercialUse: Boolean(consent?.commercial_use) }} /></div>
      <div data-guide="account.actions"><AccountActions marketing={Boolean(profile?.marketing_opt_in)} financials={isFinancialsEnabled()} /></div>
    </div>
  );
}
