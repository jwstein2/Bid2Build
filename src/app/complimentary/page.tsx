import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/layout/logo";
import { ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { claimMessage } from "@/lib/comp/grants";
import { claimPath, hashInviteToken } from "@/lib/comp/server";

export const metadata: Metadata = { title: "Complimentary access", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PLAN_NAMES = { unlimited: "Built2Bid Unlimited", enterprise: "Built2Bid Enterprise" } as const;

/**
 * Lands here from a complimentary-access invitation. Signing in first is required; the grant is only
 * given to the account whose VERIFIED email matches the invitation (checked in Postgres), so a
 * forwarded link can't hand access to someone else.
 */
export default async function ClaimComplimentary({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = ((await searchParams).token ?? "").slice(0, 200);
  if (!isSupabaseConfigured()) redirect("/");
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(token ? claimPath(token) : "/complimentary")}`);

  let outcome: { ok: true; plan: "unlimited" | "enterprise"; expiresAt: string } | { ok: false; message: string };
  if (token && /^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    const { data, error } = await createAdminClient().rpc("claim_comp_grant_by_token", { p_user_id: user.id, p_token_hash: hashInviteToken(token) });
    const r = (data ?? {}) as { ok?: boolean; plan?: "unlimited" | "enterprise"; expires_at?: string; reason?: string; hint?: string };
    outcome = !error && r.ok && r.plan && r.expires_at ? { ok: true, plan: r.plan, expiresAt: r.expires_at } : { ok: false, message: claimMessage(r.reason, r.hint) };
  } else {
    // No token: show whatever complimentary access this account already has (e.g. activated on sign-up).
    const { data } = await (await createClient()).rpc("my_comp_access");
    const mine = (Array.isArray(data) ? data[0] : null) as { plan: "unlimited" | "enterprise"; state: string; expires_at: string } | null;
    outcome = mine?.state === "active" ? { ok: true, plan: mine.plan, expiresAt: mine.expires_at } : { ok: false, message: claimMessage(undefined) };
  }

  const until = outcome.ok ? new Date(outcome.expiresAt).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }) : null;
  return (
    <main id="main" className="flex min-h-screen items-start justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <Logo />
        {outcome.ok ? (
          <>
            <h1 className="mt-6 font-display text-2xl font-extrabold">You&apos;re all set</h1>
            <p className="mt-2 text-ink-soft">
              Complimentary <strong>{PLAN_NAMES[outcome.plan]}</strong> access is active on your account until <strong>{until}</strong>.
              No payment details are needed, and you won&apos;t be charged when it ends.
            </p>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-soft">
              <li>Unlimited bids</li>
              <li>Saved Items &amp; Pricing and Proposal Templates</li>
              {outcome.plan === "enterprise" && <li>Company dashboard for you plus two team members</li>}
            </ul>
            <p className="mt-4 text-sm text-muted">When it ends your bids and customers stay right where they are. You can subscribe any time from Subscription settings to keep these features.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <ButtonLink href="/bids">Create a bid</ButtonLink>
              <ButtonLink href="/dashboard" variant="secondary">Go to dashboard</ButtonLink>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-6 font-display text-2xl font-extrabold">Complimentary access</h1>
            <Notice tone="warn" className="mt-4">{outcome.message}</Notice>
            <form action="/auth/signout" method="post" className="mt-4 text-sm text-ink-soft">Signed in as {user.email ?? user.phone ?? "this account"}. <button className="underline">Sign out to use a different account</button></form>
            <div className="mt-6"><ButtonLink href="/dashboard" variant="secondary">Go to dashboard</ButtonLink></div>
          </>
        )}
      </div>
    </main>
  );
}
