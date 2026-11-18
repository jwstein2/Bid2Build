import Link from "next/link";
import { Flash } from "@/components/creator/flash";
import { MetricTile } from "./ui";
import { createAdminClient } from "@/lib/supabase/server";
import { loadStats } from "@/lib/academy/server";

const weekAgo = () => new Date(Date.now() - 7 * 864e5).toISOString();

export default async function ManageHome({ searchParams }: PageProps<"/academy/manage">) {
  const sp = await searchParams;
  const db = createAdminClient();
  const count = async (t: string, f?: (q: ReturnType<ReturnType<typeof db.from>["select"]>) => unknown) => {
    let q = db.from(t).select("*", { count: "exact", head: true });
    if (f) q = f(q) as typeof q;
    const { count: c } = await q;
    return c ?? 0;
  };
  const [stats, open, published, upcoming, review, candidates, posts7] = await Promise.all([
    loadStats(),
    count("academy_reports", (q) => q.eq("status", "open")),
    count("academy_courses", (q) => q.eq("status", "published")),
    count("academy_courses", (q) => q.eq("status", "upcoming")),
    count("academy_courses", (q) => q.eq("status", "in_review")),
    count("academy_resources", (q) => q.eq("status", "candidate")),
    count("academy_posts", (q) => q.gte("created_at", weekAgo())),
  ]);
  return (
    <>
      <Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Members" value={stats?.members ?? 0} href="/academy/manage/members" />
        <MetricTile label="Open reports" value={open} href="/academy/manage/reports" tone={open ? "warn" : undefined} />
        <MetricTile label="Posts, last 7 days" value={posts7} href="/academy" />
        <MetricTile label="Courses in review" value={review} href="/academy/manage/courses?status=in_review" />
        <MetricTile label="Published courses" value={published} href="/academy/manage/courses?status=published" />
        <MetricTile label="Coming-soon courses" value={upcoming} href="/academy/manage/courses?status=upcoming" />
        <MetricTile label="Resources to verify" value={candidates} href="/academy/manage/resources?status=candidate" />
        <MetricTile label="Published lessons" value={stats?.published_lessons ?? 0} href="/academy/classroom" />
      </div>
      <p className="mt-6 text-sm text-ink-soft">Publishing rule: a course goes live only when its lessons are written and reviewed. Instructors can draft and set courses to In review; Academy admins publish. Every change here is written to the <Link className="font-semibold underline" href="/academy/manage/audit">audit log</Link>.</p>
    </>
  );
}
