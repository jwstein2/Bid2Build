import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { CourseCover } from "@/components/academy/course-card";
import { StatusPill, field, label } from "../../ui";
import { createAdminClient } from "@/lib/supabase/server";
import { listTrades, requireAcademyStaff, signedMediaUrls } from "@/lib/academy/server";
import { PILLARS, type CoverTheme, type Pillar } from "@/lib/academy/types";
import { addModule, saveCourse, saveLesson, setCourseResources } from "../../actions";

type CourseRow = {
  id: string; slug: string; title: string; summary: string; description: string | null; trade_slug: string | null; pillar: Pillar; level: string; access: string; status: string;
  content_class: string; cover_path: string | null; cover_theme: CoverTheme; featured: boolean; sort_order: number; planned_lessons: string[]; seo_title: string | null; seo_description: string | null;
};
const THEMES: CoverTheme[] = ["navy", "cyan", "amber", "green", "slate", "rose"];

export default async function CourseEditor({ params, searchParams }: PageProps<"/academy/manage/courses/[id]">) {
  const s = await requireAcademyStaff(["admin", "instructor"]);
  if (!s) notFound();
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const trades = await listTrades();
  let c: CourseRow | null = null;
  let modules: { id: string; title: string; sort_order: number }[] = [];
  let lessons: { id: string; slug: string; title: string; status: string; access: string; module_id: string | null; sort_order: number }[] = [];
  let resources: { id: string; title: string; creator_name: string | null; kind: string; status: string }[] = [];
  let linked = new Set<string>();
  if (!isNew) {
    const [cr, mr, lr, rr, lk] = await Promise.all([
      db.from("academy_courses").select("*").eq("id", id).maybeSingle(),
      db.from("academy_modules").select("id, title, sort_order").eq("course_id", id).order("sort_order"),
      db.from("academy_lessons").select("id, slug, title, status, access, module_id, sort_order").eq("course_id", id).order("sort_order"),
      db.from("academy_resources").select("id, title, creator_name, kind, status").in("status", ["verified", "candidate"]).order("title").limit(500),
      db.from("academy_course_resources").select("resource_id").eq("course_id", id),
    ]);
    c = cr.data as CourseRow | null;
    if (!c) notFound();
    modules = mr.data ?? []; lessons = lr.data ?? []; resources = rr.data ?? [];
    linked = new Set((lk.data ?? []).map((x: { resource_id: string }) => x.resource_id));
  }
  const covers = await signedMediaUrls([c?.cover_path]);
  const admin = s.me.role === "admin";
  const statuses = admin ? ["draft", "upcoming", "in_review", "published", "archived"] : ["draft", "upcoming", "in_review"];
  if (c && !statuses.includes(c.status)) statuses.push(c.status);
  const msg = typeof sp.msg === "string" ? sp.msg : undefined; const err = typeof sp.err === "string" ? sp.err : undefined;

  return (
    <>
      <Link href="/academy/manage/courses" className="text-sm font-semibold text-accent-ink hover:underline">← All courses</Link>
      <div className="mt-3"><Flash msg={msg} err={err} /></div>
      <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form action={saveCourse} encType="multipart/form-data" className="grid gap-4 rounded-xl border border-line bg-surface p-5" data-testid="course-form">
          <h2 className="font-bold">{isNew ? "New course" : "Course details"} {c && <StatusPill status={c.status} />}</h2>
          {c && <input type="hidden" name="id" value={c.id} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Title<input name="title" required minLength={3} maxLength={120} defaultValue={c?.title} className={field} /></label>
            <label className={label}>Slug (URL)<input name="slug" required pattern="[a-z0-9-]{3,100}" defaultValue={c?.slug} className={field} /></label>
          </div>
          <label className={label}>Summary (card text, max 240)<textarea name="summary" required maxLength={240} rows={2} defaultValue={c?.summary} className={field} /></label>
          <label className={label}>Description<textarea name="description" maxLength={4000} rows={4} defaultValue={c?.description ?? ""} className={field} /></label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className={label}>Trade<select name="trade_slug" defaultValue={c?.trade_slug ?? ""} className={field}><option value="">Every trade</option>{trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select></label>
            <label className={label}>Pillar<select name="pillar" defaultValue={c?.pillar ?? "sales"} className={field}>{PILLARS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
            <label className={label}>Level<select name="level" defaultValue={c?.level ?? "beginner"} className={field}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
            <label className={label}>Status<select name="status" defaultValue={c?.status ?? "draft"} className={field}>{statuses.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select></label>
            <label className={label}>Access<select name="access" defaultValue={c?.access ?? "public"} className={field}><option value="public">Free (public)</option><option value="members">Members</option><option value="premium">Premium</option></select></label>
            <label className={label}>Content class<select name="content_class" defaultValue={c?.content_class ?? "original"} className={field}><option value="original">Built2Bid original</option><option value="mixed">Original + curated</option><option value="curated">External curated</option><option value="licensed">Licensed</option></select></label>
            <label className={label}>Cover theme<select name="cover_theme" defaultValue={c?.cover_theme ?? "navy"} className={field}>{THEMES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className={label}>Sort order<input name="sort_order" type="number" defaultValue={c?.sort_order ?? 0} className={field} /></label>
            <label className="flex items-center gap-2 pt-6 text-sm font-semibold"><input type="checkbox" name="featured" defaultChecked={c?.featured} /> Featured</label>
          </div>
          <label className={label}>Planned lessons (one per line, shown while &quot;Coming soon&quot;)<textarea name="planned_lessons" rows={5} defaultValue={c?.planned_lessons.join("\n")} className={field} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>SEO title (max 70)<input name="seo_title" maxLength={70} defaultValue={c?.seo_title ?? ""} className={field} /></label>
            <label className={label}>SEO description (max 170)<input name="seo_description" maxLength={170} defaultValue={c?.seo_description ?? ""} className={field} /></label>
          </div>
          <label className={label}>Cover image (JPG/PNG/WebP, cropped to 16:9)<input type="file" name="cover" accept="image/jpeg,image/png,image/webp" className="mt-1 block text-sm" /></label>
          {c?.cover_path && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remove_cover" /> Remove uploaded cover (use the themed cover)</label>}
          {!admin && <p className="text-xs text-muted">Instructors can save drafts and send a course to review. An Academy admin publishes it.</p>}
          <div className="flex justify-end"><Submit>Save course</Submit></div>
        </form>
        <aside className="space-y-4">
          {c && <div className="overflow-hidden rounded-xl border border-line"><CourseCover course={c} tradeName={trades.find((t) => t.slug === c!.trade_slug)?.name} coverUrl={c.cover_path ? covers.get(c.cover_path) : null} /></div>}
          {c && <Link href={`/academy/courses/${c.slug}`} className="block text-sm font-semibold text-accent-ink hover:underline">View public page →</Link>}
        </aside>
      </div>

      {c && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-bold">Lessons</h2>
            <ol className="mt-2 divide-y divide-line text-sm">
              {lessons.length === 0 && <li className="py-2 text-muted">No lessons yet.</li>}
              {lessons.map((l) => <li key={l.id} className="flex items-center justify-between gap-2 py-2"><Link href={`/academy/manage/lessons/${l.id}`} className="font-semibold hover:underline">{l.sort_order}. {l.title}</Link><span className="flex gap-1.5"><StatusPill status={l.status} /><span className="text-xs text-muted">{l.access}</span></span></li>)}
            </ol>
            <form action={saveLesson} className="mt-4 grid gap-2 border-t border-line pt-4">
              <input type="hidden" name="course_id" value={c.id} />
              <input type="hidden" name="status" value="draft" />
              <input type="hidden" name="access" value="members" />
              <p className="text-sm font-semibold">Add a lesson (saved as a draft)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="title" required minLength={3} maxLength={140} placeholder="Lesson title" className={field} />
                <input name="slug" required pattern="[a-z0-9-]{3,100}" placeholder="lesson-slug" className={field} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select name="module_id" className={field}><option value="">No module</option>{modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
                <input name="sort_order" type="number" defaultValue={(lessons.at(-1)?.sort_order ?? 0) + 1} className={field} aria-label="Sort order" />
              </div>
              <div><Submit size="sm">Add lesson</Submit></div>
            </form>
            <form action={addModule} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
              <input type="hidden" name="course_id" value={c.id} />
              <label className={`${label} flex-1`}>New module<input name="title" required minLength={2} maxLength={120} className={field} /></label>
              <input name="sort_order" type="number" defaultValue={modules.length + 1} className={`${field} w-20`} aria-label="Module order" />
              <Submit size="sm" variant="secondary">Add module</Submit>
            </form>
            {modules.length > 0 && <p className="mt-2 text-xs text-muted">Modules: {modules.map((m) => m.title).join(" · ")}</p>}
          </section>
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-bold">Recommended resources</h2>
            <p className="text-xs text-muted">Shown on the course page. Only verified resources appear publicly.</p>
            <form action={setCourseResources} className="mt-2">
              <input type="hidden" name="course_id" value={c.id} />
              <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-line p-2 text-sm">
                {resources.map((r) => <label key={r.id} className="flex items-start gap-2"><input type="checkbox" name="resource_ids" value={r.id} defaultChecked={linked.has(r.id)} className="mt-0.5" /><span>{r.title} <span className="text-xs text-muted">· {r.creator_name} · {r.kind}{r.status !== "verified" ? " · not verified" : ""}</span></span></label>)}
              </div>
              <div className="mt-2"><Submit size="sm" variant="secondary">Save resources</Submit></div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
