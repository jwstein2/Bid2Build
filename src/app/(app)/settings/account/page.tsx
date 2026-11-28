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
import { InstallDesktopCard } from "@/components/pwa/install-desktop-card";

export const metadata: Metadata = { title: "Account settings", robots: { index: false } };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
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
      {user.demo ? (
        // A sample login: sign-in methods would send real codes to a reserved address, so they stay hidden.
        <Card className="p-5" data-testid="demo-signin-note">
          <h2 className="font-bold">Sign-in settings</h2>
          <p className="text-sm text-ink-soft">You&apos;re in {user.demo.kind === "practice" ? "Practice Mode" : "Demo Mode"}, which uses a fake sample account. Turn it off to change how you sign in to your real account.</p>
        </Card>
      ) : (
        <>
          <div data-guide="account.signin"><SignInMethods email={user.email} emailVerified={user.emailVerified} phone={user.phone} phoneVerified={user.phoneVerified} smsEnabled={isSmsSignInEnabled()} /></div>
          <TwoStepSignIn admin={isAdmin === true} adminRequired={isAdmin === true && reason === "admin_two_step"} />
        </>
      )}
      {hasSales(workspaces) && <LandingPreference ws={workspaces} />}
      {/* V10.1: install the same Built2Bid as a desktop app (hidden inside the installed app). */}
      <InstallDesktopCard id="install-app" className="scroll-mt-20 p-5" />
      {!user.demo && (isAdmin === true || isPracticeEnabled()) && (
        <Card className="scroll-mt-20 p-5" id="practice" data-testid="demo-settings-card">
          <h2 className="font-bold">{isAdmin === true ? "Demo Mode" : "Practice Mode"}</h2>
          <p className="text-sm text-ink-soft">
            {isAdmin === true
              ? "Show Built2Bid with a fully populated sample company. It opens in a separate demo workspace: your real customers, bids, billing and settings are never changed, and nothing in the demo reaches a real person or payment system."
              : "Try Built2Bid with fake sample customers and bids in a separate practice workspace. Nothing there is real: no emails or texts are sent and nothing is charged. Your real account stays exactly as it is. You can also turn it on and off from the menu."}
          </p>
          <DemoEnterButton kind={isAdmin === true ? "owner_demo" : "practice"} className="mt-3" variant="primary" />
        </Card>
      )}
      {isContractorSigningEnabled() && !user.demo && (
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
