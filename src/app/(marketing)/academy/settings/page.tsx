import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/misc";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { MembersOnly } from "@/components/academy/gate";
import { listTrades, loadMe } from "@/lib/academy/server";
import { PILLARS, US_STATES } from "@/lib/academy/types";
import { createClient } from "@/lib/supabase/server";
import { leaveAcademy, updateProfile } from "../actions";
import { ChallengeCard } from "@/components/academy/challenge-card";
import { loadChallenge } from "@/lib/academy/rewards-server";

export const metadata: Metadata = { title: "My Academy profile", robots: { index: false, follow: false } };

const input = "mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-normal";
type Member = {
  display_name: string; headline: string | null; bio: string | null; trades: string[]; primary_trade: string | null; state_code: string | null; company_name: string | null;
  interests: string[]; show_company: boolean; show_location: boolean; show_trades: boolean; directory_visible: boolean; leaderboard_visible: boolean;
};

export default async function SettingsPage({ searchParams }: PageProps<"/academy/settings">) {
  const sp = await searchParams;
  const { me, migrated, user } = await loadMe();
  if (!me.member || !user) return <MembersOnly me={me} migrated={migrated} what="Your Academy profile" />;
  const [{ data }, trades, challenge] = await Promise.all([
    (await createClient()).from("academy_members").select("display_name, headline, bio, trades, primary_trade, state_code, company_name, interests, show_company, show_location, show_trades, directory_visible, leaderboard_visible").eq("user_id", user.id).maybeSingle(),
    listTrades(),
    loadChallenge(),
  ]);
  const m = data as Member | null;
  if (!m) return <MembersOnly me={me} migrated={migrated} what="Your Academy profile" />;
  const toggles: [keyof Member, string, string][] = [
    ["directory_visible", "Show me in the member directory", "Other members can find your profile. Your posts still show your name."],
    ["leaderboard_visible", "Show me on the leaderboard", "You still earn points and levels when this is off."],
    ["show_trades", "Show my trades", ""],
    ["show_location", "Show my state", ""],
    ["show_company", "Show my company name", "Off by default."],
  ];
  return (
    <Container className="py-6">
      <div className="max-w-2xl">
        <h1 className="font-display text-2xl font-extrabold">My Academy profile</h1>
        <p className="mt-1 text-sm text-ink-soft">This profile is separate from your Built2Bid business profile. Changing it doesn&apos;t change your estimates or proposals. <Link href={`/academy/members/${user.id}`} className="font-semibold text-accent-ink underline">View my profile</Link></p>
        {challenge && <ChallengeCard status={challenge} className="mt-4" />}
        <div className="mt-3"><Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} /></div>
        <form action={updateProfile} className="mt-4 grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card" data-testid="profile-form">
          <label className="text-sm font-semibold">Display name<input name="display_name" required minLength={2} maxLength={60} defaultValue={m.display_name} className={input} /></label>
          <label className="text-sm font-semibold">Headline<input name="headline" maxLength={120} defaultValue={m.headline ?? ""} placeholder="Owner, 3-crew roofing company" className={input} /></label>
          <label className="text-sm font-semibold">About you<textarea name="bio" maxLength={1000} rows={4} defaultValue={m.bio ?? ""} className={input} /></label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold">Primary trade<select name="primary_trade" defaultValue={m.primary_trade ?? ""} className={input}><option value="">—</option>{trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select></label>
            <label className="text-sm font-semibold">State<select name="state_code" defaultValue={m.state_code ?? ""} className={input}><option value="">—</option>{US_STATES.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="text-sm font-semibold">Company<input name="company_name" maxLength={120} defaultValue={m.company_name ?? ""} className={input} /></label>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold">Other trades (up to 10)</legend>
            <div className="mt-2 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-line p-2 text-sm sm:grid-cols-3">
              {trades.map((t) => <label key={t.slug} className="flex items-center gap-1.5"><input type="checkbox" name="trades" value={t.slug} defaultChecked={m.trades.includes(t.slug)} /> {t.name}</label>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">What do you want to get better at?</legend>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {PILLARS.map((p) => <label key={p.key} className="flex items-center gap-1.5"><input type="checkbox" name="interests" value={p.key} defaultChecked={m.interests.includes(p.key)} /> {p.short}</label>)}
            </div>
          </fieldset>
          <fieldset className="rounded-lg border border-line p-4">
            <legend className="px-1 text-sm font-semibold">Privacy</legend>
            <div className="space-y-3">
              {toggles.map(([k, label, hint]) => (
                <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" name={k} defaultChecked={Boolean(m[k])} className="mt-0.5" />
                  <span><span className="font-semibold">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span></label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end"><Submit>Save profile</Submit></div>
        </form>
        <section className="mt-8 rounded-xl border border-danger/30 bg-surface p-5">
          <h2 className="font-bold">Leave the Academy community</h2>
          <p className="mt-1 text-sm text-ink-soft">You&apos;ll be removed from the directory and leaderboard and can&apos;t post. Your Built2Bid account, plan and bids aren&apos;t affected, and you can rejoin any time.</p>
          <form action={leaveAcademy} className="mt-3"><Submit variant="danger" size="sm" pending="Leaving…">Leave community</Submit></form>
        </section>
      </div>
    </Container>
  );
}
