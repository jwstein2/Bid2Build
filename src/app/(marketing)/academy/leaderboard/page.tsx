import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { Avatar } from "@/components/academy/avatar";
import { MembersOnly } from "@/components/academy/gate";
import { listTrades, loadMe } from "@/lib/academy/server";
import { LEVELS, levelName } from "@/lib/academy/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Academy Leaderboard", robots: { index: false, follow: false } };

const PERIODS = [{ key: "week", label: "Last 7 days" }, { key: "month", label: "Last 30 days" }, { key: "all", label: "All time" }] as const;
type Row = { rank: number; user_id: string; display_name: string; primary_trade: string | null; points: number; level: number; is_me: boolean };

export default async function LeaderboardPage({ searchParams }: PageProps<"/academy/leaderboard">) {
  const sp = await searchParams;
  const { me, migrated } = await loadMe();
  if (!me.member) return <MembersOnly me={me} migrated={migrated} what="The leaderboard" />;
  const period = PERIODS.find((p) => p.key === sp.period)?.key ?? "week";
  const db = await createClient();
  const [{ data }, trades, settings] = await Promise.all([
    db.rpc("academy_leaderboard", { p_period: period, p_limit: 25 }),
    listTrades(),
    db.from("academy_settings").select("points_reaction, points_helpful, points_course, daily_point_cap, pair_daily_cap").maybeSingle(),
  ]);
  const rows = (data ?? []) as Row[];
  const tradeName = new Map(trades.map((t) => [t.slug, t.name]));
  const st = settings.data ?? { points_reaction: 1, points_helpful: 5, points_course: 2, daily_point_cap: 25, pair_daily_cap: 3 };

  return (
    <Container className="py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold"><Trophy className="h-6 w-6 text-accent-ink" aria-hidden /> Leaderboard</h1>
          <div className="mt-4 flex gap-1.5" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <Link key={p.key} role="tab" aria-selected={p.key === period} href={`/academy/leaderboard?period=${p.key}`}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${p.key === period ? "border-navy bg-navy text-white" : "border-line bg-surface text-ink-soft hover:border-line-strong"}`}>{p.label}</Link>
            ))}
          </div>
          <ol className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card" data-testid="leaderboard">
            {rows.length === 0 && <li className="p-8 text-center text-sm text-ink-soft">No points earned in this period yet. Helpful answers and finished lessons earn points.</li>}
            {rows.map((r) => (
              <li key={r.user_id} className={`flex items-center gap-3 p-3 ${r.is_me ? "bg-accent-tint" : ""}`}>
                <span className={`w-8 text-center font-display text-lg font-extrabold ${r.rank <= 3 ? "text-accent-ink" : "text-muted"}`}>{r.rank}</span>
                <Avatar id={r.user_id} name={r.display_name} level={r.level} size="sm" />
                <span className="min-w-0 flex-1">
                  <Link href={`/academy/members/${r.user_id}`} className="font-semibold hover:underline">{r.display_name}</Link>{r.is_me && <span className="ml-1.5 text-xs text-muted">(you)</span>}
                  <span className="block text-xs text-muted">{levelName(r.level)}{r.primary_trade ? ` · ${tradeName.get(r.primary_trade) ?? r.primary_trade}` : ""}</span>
                </span>
                <span className="text-sm font-bold">+{Number(r.points).toLocaleString("en-US")}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">Members who turned off leaderboard visibility in their privacy settings aren&apos;t listed.</p>
        </div>
        <aside className="space-y-4">
          <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="font-bold">How points work</h2>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              <li>+{st.points_reaction} when another member likes your post or comment</li>
              <li>+{st.points_helpful} when your answer is marked helpful</li>
              <li>+{st.points_course} for each lesson you finish</li>
            </ul>
            <p className="mt-2 text-xs text-muted">To keep it fair: no points for liking your own content, at most {st.pair_daily_cap} points a day from any one member, {st.daily_point_cap} points a day in total from likes and answers, and none for accounts less than a day old. Removed posts lose their points.</p>
          </section>
          <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="font-bold">Levels</h2>
            <ol className="mt-2 space-y-0.5 text-sm">{LEVELS.map((l) => <li key={l.level} className={l.level === me.level ? "font-semibold" : "text-ink-soft"}>{l.level}. {l.name} <span className="text-xs text-muted">({l.min}+ pts)</span></li>)}</ol>
          </section>
        </aside>
      </div>
    </Container>
  );
}
