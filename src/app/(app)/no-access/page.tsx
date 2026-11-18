import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { WORKSPACE_INFO, isFeatureId, FEATURE_BY_ID } from "@/lib/access/capabilities";
import { loadEffectiveAccess } from "@/lib/access/server";
import { buildNav } from "@/lib/access/nav";

export const metadata: Metadata = { title: "No access", robots: { index: false } };

/** Where a URL guard sends a company member whose access settings turn a feature off (V6.7). Nothing about the record is shown. */
export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ feature?: string }> }) {
  const { feature } = await searchParams;
  const f = isFeatureId(feature) ? FEATURE_BY_ID[feature] : null;
  const access = await loadEffectiveAccess(await createClient()).catch(() => null);
  const first = access ? buildNav(access).flatMap((g) => g.items)[0] : null;
  return (
    <div className="mx-auto max-w-xl py-10 text-center" data-testid="no-access">
      <Lock className="mx-auto h-10 w-10 text-muted" aria-hidden />
      <h1 className="mt-3 text-2xl font-extrabold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-ink-soft">
        {f ? <><b>{f.label}</b> ({WORKSPACE_INFO[f.section].label}) is turned off for your account.</> : "This part of Built2Bid is turned off for your account."}
        {" "}Your company administrator controls this under Company → Team &amp; Access. Nothing was changed or deleted.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href={first?.href ?? "/settings/account"} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-white">{first ? `Go to ${first.label}` : "Account settings"}</Link>
      </div>
    </div>
  );
}
