import type { Metadata } from "next";
import { Container } from "@/components/ui/misc";
import { MembersOnly } from "@/components/academy/gate";
import { FeedList } from "@/components/academy/feed-list";
import { CourseCard } from "@/components/academy/course-card";
import { listCourses, listTrades, loadMe, myProgress } from "@/lib/academy/server";
import { loadFeed } from "@/lib/academy/community";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Saved", robots: { index: false, follow: false } };

export default async function SavedPage() {
  const { me, migrated, user } = await loadMe();
  if (!me.member || !user) return <MembersOnly me={me} migrated={migrated} what="Saved items" />;
  const db = await createClient();
  const [feed, trades, courses, progress, { data: marks }] = await Promise.all([
    loadFeed({ saved: true, sort: "new" }), listTrades(), listCourses({}), myProgress(),
    db.from("academy_bookmarks").select("target_id").eq("user_id", user.id).eq("target_type", "course").limit(200),
  ]);
  const tradeName = new Map(trades.map((t) => [t.slug, t.name]));
  const ids = new Set((marks ?? []).map((m: { target_id: string }) => m.target_id));
  const savedCourses = courses.filter((c) => ids.has(c.id));
  return (
    <Container className="py-6">
      <h1 className="font-display text-2xl font-extrabold">Saved</h1>
      <section className="mt-5" aria-labelledby="sc-h">
        <h2 id="sc-h" className="font-bold">Courses</h2>
        {savedCourses.length ? (
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{savedCourses.map((c) => <CourseCard key={c.id} course={c} tradeName={c.trade_slug ? tradeName.get(c.trade_slug) : null} progress={progress.get(c.id)} />)}</ul>
        ) : <p className="mt-2 text-sm text-ink-soft">Use Save on a course page to keep it here.</p>}
      </section>
      <section className="mt-8" aria-labelledby="sp-h">
        <h2 id="sp-h" className="font-bold">Discussions</h2>
        <div className="mt-3"><FeedList rows={feed.rows} empty="Use Save on a discussion to keep it here." tradeName={tradeName} /></div>
      </section>
    </Container>
  );
}
