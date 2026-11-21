import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { buttonClass } from "@/components/ui/button";
import { Submit } from "@/components/academy/controls";
import { StatusPill, field } from "../ui";
import { saveReleaseSettings } from "../actions";
import { centralToday, releaseLabel } from "@/lib/academy/release-plan";
import { createAdminClient } from "@/lib/supabase/server";
import { listTrades, requireAcademyStaff } from "@/lib/academy/server";
import { PILLARS, pillarMeta } from "@/lib/academy/types";

const STATUSES = ["draft", "upcoming", "in_review", "published", "archived"];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function ManageCourses({ searchParams }: PageProps<"/academy/manage/courses">) {
  const staff = await requireAcademyStaff(["admin", "instructor"]);
  if (!staff) notFound();
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const trades = await listTrades();
  const tradeName = new Map(trades.map((t) => [t.slug, t.name]));
  const db = createAdminClient();
  const byRelease = s("sort") === "release";
  let q = db.from("academy_courses").select("id, slug, title, trade_slug, pillar, status, access, featured, sort_order, updated_at, release_on, planned_lessons, academy_lessons(count)");
  q = byRelease ? q.order("release_on", { nullsFirst: false }).order("sort_order") : q.order("trade_slug", { nullsFirst: true }).order("sort_order");
  q = q.limit(400);
  if (s("trade") === "_all") q = q.is("trade_slug", null); else if (tradeName.has(s("trade"))) q = q.eq("trade_slug", s("trade"));
  if (STATUSES.includes(s("status"))) q = q.eq("status", s("status"));
  if (PILLARS.some((p) => p.key === s("pillar"))) q = q.eq("pillar", s("pillar"));
  if (s("q")) q = q.ilike("title", `%${s("q").replace(/[%_]/g, "").slice(0, 60)}%`);
  const [{ data }, { data: settings }, { data: sched }] = await Promise.all([
    q,
    db.from("academy_settings").select("auto_release, release_per_week, release_weekday").eq("id", true).maybeSingle(),
    db.from("academy_courses").select("title, release_on").eq("status", "upcoming").not("release_on", "is", null).order("release_on").order("sort_order").limit(1000),
  ]);
  type Row = { id: string; slug: string; title: string; trade_slug: string | null; pillar: string; status: string; access: string; featured: boolean; sort_order: number; updated_at: string; release_on: string | null; planned_lessons: string[]; academy_lessons?: { count: number }[] };
  const rows = (data ?? []) as Row[];
  const isAdmin = staff.me.role === "admin";
  const today = centralToday();
  const scheduled = (sched ?? []) as { title: string; release_on: string }[];
  const nextDay = scheduled.find((c) => c.release_on >= today)?.release_on;
  const nextBatch = scheduled.filter((c) => c.release_on === nextDay);
  const lastDay = scheduled.at(-1)?.release_on;
  const overdue = scheduled.filter((c) => c.release_on < today).length;
  const perWeek = settings?.release_per_week ?? 2;
  const weekday = settings?.release_weekday ?? 1;
  const paused = settings?.auto_release === false;
  return (
    <>
      <Flash msg={s("msg") || undefined} err={s("err") || undefined} />
      {settings && (
        <section className="mb-5 rounded-xl border border-line bg-surface p-4" data-testid="release-schedule">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">Weekly releases {paused && <span className="ml-1 rounded bg-warn-tint px-1.5 py-0.5 text-[11px] font-semibold text-warn">paused</span>}</h2>
              <p className="mt-1 text-sm text-ink-soft">
                {perWeek} {perWeek === 1 ? "course" : "courses"} every {WEEKDAYS[weekday - 1]}.{" "}
                {nextDay ? <>Next: <strong>{releaseLabel(nextDay, { weekday: true })}</strong> ({nextBatch.map((c) => c.title).join("; ")}).</> : "Nothing scheduled."}
                {lastDay && <> {scheduled.length} still to come; the last one is scheduled for {releaseLabel(lastDay)}.</>}
                {overdue > 0 && <> {overdue} past their date are waiting for lessons to finish writing.</>}
              </p>
              <p className="mt-1 text-xs text-muted">Lessons are written with Claude Haiku up to two weeks before each release and stay hidden until the course goes live, so you can edit or delete them first. Courses publish automatically on their date (Central time).</p>
            </div>
          </div>
          {isAdmin && (
            <form action={saveReleaseSettings} className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3 text-sm">
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="auto_release" defaultChecked={!paused} /> Release automatically</label>
              <label className="font-semibold">Per week<input name="release_per_week" type="number" min={1} max={14} defaultValue={perWeek} className={`${field} w-20`} /></label>
              <label className="font-semibold">On<select name="release_weekday" defaultValue={weekday} className={`${field} w-36`}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="repack" /> Rebuild dates (close gaps from deleted courses)</label>
              <Submit size="sm" variant="secondary">Save schedule</Submit>
            </form>
          )}
        </section>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2" action="/academy/manage/courses">
          <input name="q" defaultValue={s("q")} placeholder="Search titles" className={`${field} w-48`} />
          <select name="trade" defaultValue={s("trade")} className={`${field} w-44`}><option value="">Any trade</option><option value="_all">Every trade (general)</option>{trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select>
          <select name="pillar" defaultValue={s("pillar")} className={`${field} w-40`}><option value="">Any pillar</option>{PILLARS.map((p) => <option key={p.key} value={p.key}>{p.short}</option>)}</select>
          <select name="status" defaultValue={s("status")} className={`${field} w-36`}><option value="">Any status</option>{STATUSES.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select>
          <select name="sort" defaultValue={s("sort")} className={`${field} w-40`} aria-label="Sort"><option value="">Catalog order</option><option value="release">Release date</option></select>
          <button className={buttonClass("secondary", "sm", "mb-0.5")}>Filter</button>
        </form>
        <Link href="/academy/manage/courses/new" className={buttonClass("primary", "sm")}>New course</Link>
      </div>
      <p className="mt-3 text-xs text-muted">{rows.length} courses{rows.length === 400 ? " (first 400; narrow the filters)" : ""}</p>
      <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-paper text-left text-xs text-muted"><tr><th className="p-2">Course</th><th className="p-2">Trade</th><th className="p-2">Pillar</th><th className="p-2">Status</th><th className="p-2">Release</th><th className="p-2">Lessons</th><th className="p-2">Access</th><th className="p-2">Order</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="p-2"><Link href={`/academy/manage/courses/${c.id}`} className="font-semibold hover:underline">{c.title}</Link>{c.featured && <span className="ml-1 text-xs text-accent-ink">★</span>}<span className="block text-xs text-muted">/{c.slug}</span></td>
                <td className="p-2">{c.trade_slug ? tradeName.get(c.trade_slug) ?? c.trade_slug : "Every trade"}</td>
                <td className="p-2">{pillarMeta(c.pillar).short}</td>
                <td className="p-2"><StatusPill status={c.status} /></td>
                <td className="whitespace-nowrap p-2">{c.status === "upcoming" && c.release_on ? releaseLabel(c.release_on) : "—"}</td>
                <td className="p-2">{c.academy_lessons?.[0]?.count ?? 0}{c.status !== "published" && c.planned_lessons.length ? ` / ${c.planned_lessons.length}` : ""}</td>
                <td className="p-2">{c.access}</td>
                <td className="p-2">{c.sort_order}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
