import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container, Notice } from "@/components/ui/misc";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { loadSettings } from "@/components/academy/sidebar";
import { createClient } from "@/lib/supabase/server";
import { listTrades, loadMe } from "@/lib/academy/server";
import { US_STATES } from "@/lib/academy/types";
import { joinAcademy } from "../actions";
import { LegalStatusCompact } from "@/components/legal/legal-status";

export const metadata: Metadata = { title: "Join the Contractor Academy", robots: { index: false } };
const input = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";

export default async function JoinPage({ searchParams }: PageProps<"/academy/join">) {
  const sp = await searchParams;
  const { user, me, migrated } = await loadMe();
  if (!user) redirect("/login?next=/academy/join");
  if (me.member) redirect("/academy");
  const [trades, settings] = await Promise.all([listTrades(), loadSettings()]);
  // Prefill from the Built2Bid profile the person already has (they can change anything here).
  const db = await createClient();
  const [{ data: profile }, { data: biz }] = await Promise.all([
    db.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    db.from("business_profiles").select("company_name, contact_name, primary_trade").eq("user_id", user.id).maybeSingle(),
  ]);
  const name = (profile?.display_name as string | null) || (biz?.contact_name as string | null) || "";
  const company = (biz?.company_name as string | null) || "";
  const primary = trades.some((t) => t.slug === biz?.primary_trade) ? (biz?.primary_trade as string) : "";

  return (
    <Container className="max-w-2xl py-8">
      <h1 className="font-display text-3xl font-extrabold">Join the Contractor Academy</h1>
      <p className="mt-2 text-ink-soft">Free with your Built2Bid account. No new password, and nothing about your billing or customers is shared.</p>
      <div className="mt-4"><Flash err={typeof sp.err === "string" ? sp.err : undefined} /></div>
      {!migrated ? (
        <Notice className="mt-4" title="Almost ready">The community is being set up. Please check back soon.</Notice>
      ) : me.status === "banned" ? (
        <Notice tone="danger" className="mt-4">This account can&apos;t join the Academy community.</Notice>
      ) : (
        <form action={joinAcademy} className="mt-6 grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <label className="text-sm font-semibold">Display name (shown to members)
            <input name="display_name" required minLength={2} maxLength={60} defaultValue={name} className={`${input} mt-1`} autoComplete="name" />
          </label>
          <label className="text-sm font-semibold">Primary trade
            <select name="primary_trade" defaultValue={primary} className={`${input} mt-1`}>
              <option value="">Choose your main trade</option>
              {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-semibold">Other trades you work in (optional)</legend>
            <div className="mt-2 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-line p-2 text-sm sm:grid-cols-3">
              {trades.map((t) => <label key={t.slug} className="flex items-center gap-1.5"><input type="checkbox" name="trades" value={t.slug} /> {t.name}</label>)}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">State (optional)
              <select name="state_code" defaultValue="" className={`${input} mt-1`}><option value="">—</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}</select>
            </label>
            <label className="text-sm font-semibold">Company name (optional)
              <input name="company_name" maxLength={120} defaultValue={company} className={`${input} mt-1`} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="show_company" /> Show my company name in the member directory</label>
          <div className="rounded-lg bg-paper p-3 text-sm">
            <p className="font-semibold">Community rules</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-soft">{settings.rules.map((r) => <li key={r}>{r}</li>)}</ol>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="accept_rules" required className="mt-1" /> <span>I agree to the community rules and the <Link href="/academy-terms" className="underline" target="_blank">Academy terms</Link>.</span></label>
          <p className="text-xs text-muted">Your email, phone number and billing details are never shown. You choose what appears in the directory and leaderboards in <b>My profile</b>, and you can leave the community at any time.</p>
          <div className="flex items-center gap-3"><Submit variant="accent" pending="Joining…">Join the community</Submit><Link href="/academy/classroom" className="text-sm font-semibold text-accent-ink hover:underline">Just browse the Classroom</Link></div>
          <LegalStatusCompact />
        </form>
      )}
    </Container>
  );
}
