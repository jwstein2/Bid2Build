import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { loadReader } from "@/lib/news/server";
import { trades, tradeName } from "@/lib/trades/catalog";
import { PreferencesForm } from "@/components/news/preferences-form";

export const metadata: Metadata = { title: "News preferences", robots: { index: false } };

/** Personalize Industry Intelligence. Starts from the company profile (no double entry) and company defaults. */
export default async function NewsPreferencesPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/industry/preferences");
  const db = await createClient();
  const r = await loadReader(db, user.id);
  const place = [r.ctx.city, r.ctx.state, r.ctx.zip].filter(Boolean).join(", ");
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-sm"><Link href="/industry" className="text-accent-ink underline-offset-4 hover:underline">Industry Intelligence</Link></p>
        <h1 className="text-3xl font-extrabold text-navy">News preferences</h1>
        <p className="mt-1 text-ink-soft">
          From your company profile: {r.profileTrade ? <span className="font-semibold">{tradeName(r.profileTrade)}</span> : "no trade set"}
          {place ? <> · <span className="font-semibold">{place}</span></> : " · no business address"}. <Link href="/settings/company" className="text-accent-ink underline">Edit company profile</Link>
        </p>
        {r.prefs.fromCompany && <p className="mt-1 text-sm text-muted">You&apos;re using your company&apos;s news defaults. Saving here makes these your own.</p>}
      </div>
      <PreferencesForm
        initial={r.prefs}
        defaultTrades={r.ctx.trades}
        trades={trades.map((t) => ({ slug: t.slug, name: t.name }))}
        canManageCompany={r.canManageCompany}
      />
    </div>
  );
}
