import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { Avatar } from "@/components/academy/avatar";
import { ROLE_LABEL } from "@/components/academy/format";
import { MembersOnly } from "@/components/academy/gate";
import { FeedList } from "@/components/academy/feed-list";
import { listTrades, loadMe } from "@/lib/academy/server";
import { loadFeed } from "@/lib/academy/community";
import { LEVELS, levelName } from "@/lib/academy/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Member profile", robots: { index: false, follow: false } };

type Profile = {
  user_id: string; display_name: string; headline: string | null; bio: string | null; trades: string[]; state_code: string | null; company_name: string | null;
  role: string; tier: string; joined_at: string; points: number; level: number; badges: { badge: string; label: string; awarded_at: string }[]; post_count: number; helpful_count: number;
};

export default async function MemberProfile({ params }: PageProps<"/academy/members/[id]">) {
  const { id } = await params;
  const { me, migrated, user } = await loadMe();
  if (!me.member) return <MembersOnly me={me} migrated={migrated} what="Member profiles" />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data, error } = await (await createClient()).rpc("academy_profile", { p_user_id: id });
  if (error || !data) notFound();
  const p = data as Profile;
  const [trades, posts] = await Promise.all([listTrades(), loadFeed({ author: id, sort: "new" })]);
  const tradeName = new Map(trades.map((t) => [t.slug, t.name]));
  const nextLevel = LEVELS.find((l) => l.level === p.level + 1);
  const isMe = user?.id === id;
  const staff = ["admin", "moderator"].includes(me.role ?? "");

  return (
    <Container className="py-6">
      <Link href="/academy/members" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Members</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="self-start rounded-xl border border-line bg-surface p-5 shadow-card" data-testid="member-profile">
          <Avatar id={p.user_id} name={p.display_name} level={p.level} size="lg" />
          <h1 className="mt-3 font-display text-2xl font-extrabold">{p.display_name}</h1>
          {p.role !== "member" && <p className="mt-1"><span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-semibold text-navy">{ROLE_LABEL[p.role]}</span></p>}
          {p.headline && <p className="mt-2 text-ink-soft">{p.headline}</p>}
          <dl className="mt-4 space-y-1.5 text-sm">
            {p.company_name && <div><dt className="inline font-semibold">Company: </dt><dd className="inline text-ink-soft">{p.company_name}</dd></div>}
            {p.state_code && <div><dt className="inline font-semibold">State: </dt><dd className="inline text-ink-soft">{p.state_code}</dd></div>}
            {p.trades.length > 0 && <div><dt className="inline font-semibold">Trades: </dt><dd className="inline text-ink-soft">{p.trades.map((t) => tradeName.get(t) ?? t).join(", ")}</dd></div>}
            <div><dt className="inline font-semibold">Joined: </dt><dd className="inline text-ink-soft">{new Date(p.joined_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</dd></div>
          </dl>
          <div className="mt-4 rounded-lg bg-paper p-3 text-sm">
            <p className="font-semibold">Level {p.level} · {levelName(p.level)}</p>
            <p className="text-muted">{Number(p.points).toLocaleString("en-US")} points{nextLevel ? ` · ${Math.max(0, nextLevel.min - Number(p.points))} to ${nextLevel.name}` : ""}</p>
            <p className="mt-1 text-muted">{p.post_count} posts · {p.helpful_count} helpful answers</p>
          </div>
          {isMe && <Link href="/academy/settings" className={buttonClass("secondary", "sm", "mt-4 w-full")}>Edit profile and privacy</Link>}
          {staff && !isMe && <Link href={`/academy/manage/members?user=${p.user_id}`} className={buttonClass("ghost", "sm", "mt-2 w-full")}>Manage member</Link>}
        </aside>
        <div className="min-w-0">
          {p.bio && <section className="rounded-xl border border-line bg-surface p-5"><h2 className="font-bold">About</h2><p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{p.bio}</p></section>}
          {p.badges.length > 0 && (
            <section className="mt-4" aria-labelledby="badges-h">
              <h2 id="badges-h" className="font-bold">Badges</h2>
              <ul className="mt-2 flex flex-wrap gap-2">{p.badges.map((b) => <li key={b.badge} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold"><Award className="h-3.5 w-3.5 text-accent-ink" aria-hidden />{b.label}</li>)}</ul>
            </section>
          )}
          <section className="mt-6" aria-labelledby="posts-h">
            <h2 id="posts-h" className="font-bold">Recent posts</h2>
            <div className="mt-2"><FeedList rows={posts.rows} empty="No posts yet." tradeName={tradeName} /></div>
          </section>
        </div>
      </div>
    </Container>
  );
}
