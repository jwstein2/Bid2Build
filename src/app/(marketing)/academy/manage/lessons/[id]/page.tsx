import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { StatusPill, field, label } from "../../ui";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";
import type { AppAction, QuizQuestion } from "@/lib/academy/types";
import { isAiConfigured } from "@/lib/ai/provider";
import { deleteLesson, draftLessonSummary, saveLesson, setLessonResources } from "../../actions";

type LessonRow = {
  id: string; course_id: string; module_id: string | null; slug: string; title: string; summary: string | null; body_md: string | null; takeaways: string[]; checklist: string[];
  trade_notes: Record<string, string>; app_action: AppAction | null; quiz: QuizQuestion[] | null; access: string; status: string; estimated_minutes: number | null; sort_order: number;
};
const FEATURES = ["estimate", "proposal", "pipeline", "customers", "communications", "pm", "schedule", "financials", "team", "saved_items"];

export default async function LessonEditor({ params, searchParams }: PageProps<"/academy/manage/lessons/[id]">) {
  const s = await requireAcademyStaff(["admin", "instructor"]);
  if (!s) notFound();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data } = await db.from("academy_lessons").select("*").eq("id", id).maybeSingle();
  const l = data as LessonRow | null;
  if (!l) notFound();
  const [{ data: course }, { data: modules }, { data: resources }, { data: linked }] = await Promise.all([
    db.from("academy_courses").select("id, slug, title").eq("id", l.course_id).single(),
    db.from("academy_modules").select("id, title").eq("course_id", l.course_id).order("sort_order"),
    db.from("academy_resources").select("id, title, creator_name, kind, status").in("status", ["verified", "candidate"]).order("title").limit(500),
    db.from("academy_lesson_resources").select("resource_id").eq("lesson_id", id),
  ]);
  const on = new Set((linked ?? []).map((x: { resource_id: string }) => x.resource_id));
  const q = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const aiSummary = q("ai_summary"); const aiTakeaways = q("ai_takeaways");
  const admin = s.me.role === "admin";
  const a = l.app_action;

  return (
    <>
      <Link href={`/academy/manage/courses/${l.course_id}`} className="text-sm font-semibold text-accent-ink hover:underline">← {course?.title ?? "Course"}</Link>
      <div className="mt-3"><Flash msg={q("msg")} err={q("err")} /></div>
      <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form action={saveLesson} className="grid gap-4 rounded-xl border border-line bg-surface p-5" data-testid="lesson-form">
          <h2 className="font-bold">Lesson <StatusPill status={l.status} /></h2>
          <input type="hidden" name="id" value={l.id} /><input type="hidden" name="course_id" value={l.course_id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Title<input name="title" required minLength={3} maxLength={140} defaultValue={l.title} className={field} /></label>
            <label className={label}>Slug<input name="slug" required pattern="[a-z0-9-]{3,100}" defaultValue={l.slug} className={field} /></label>
          </div>
          <label className={label}>Summary{aiSummary && <span className="ml-2 text-xs font-normal text-accent-ink">AI draft filled in. Review before saving.</span>}<textarea name="summary" maxLength={300} rows={2} defaultValue={aiSummary ?? l.summary ?? ""} className={field} /></label>
          <label className={label}>Lesson body (Markdown: paragraphs, ### headings, - lists, **bold**)<textarea name="body_md" maxLength={30000} rows={16} defaultValue={l.body_md ?? ""} className={`${field} font-mono`} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Takeaways (one per line){aiTakeaways && <span className="ml-1 text-xs font-normal text-accent-ink">AI draft</span>}<textarea name="takeaways" rows={5} defaultValue={aiTakeaways ?? l.takeaways.join("\n")} className={field} /></label>
            <label className={label}>Checklist (one per line)<textarea name="checklist" rows={5} defaultValue={l.checklist.join("\n")} className={field} /></label>
          </div>
          <label className={label}>Trade notes (one per line as trade-slug: note)<textarea name="trade_notes" rows={5} defaultValue={Object.entries(l.trade_notes ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n")} className={field} /></label>
          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Put it into practice in Built2Bid (optional)</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={label}>Button label<input name="action_label" maxLength={80} defaultValue={a?.label ?? ""} className={field} /></label>
              <label className={label}>In-app link<input name="action_href" maxLength={200} placeholder="/builder" defaultValue={a?.href ?? ""} className={field} /></label>
              <label className={label}>Area<select name="action_feature" defaultValue={a?.area ?? "estimate"} className={field}>{FEATURES.map((f) => <option key={f}>{f}</option>)}</select></label>
            </div>
            <label className={`${label} mt-3 block`}>Why it helps<input name="action_why" maxLength={300} defaultValue={a?.why ?? ""} className={field} /></label>
            <p className="mt-1 text-xs text-muted">Area &quot;pm&quot; or &quot;schedule&quot; shows a preview and upgrade link to members without Project Command Center.</p>
          </fieldset>
          <label className={label}>Quiz (JSON array of {"{ q, options, answer, explain }"}, optional)<textarea name="quiz" rows={5} defaultValue={l.quiz ? JSON.stringify(l.quiz, null, 2) : ""} className={`${field} font-mono text-xs`} /></label>
          <div className="grid gap-4 sm:grid-cols-4">
            <label className={label}>Status<select name="status" defaultValue={l.status} className={field}><option value="draft">draft</option>{(admin || l.status === "published") && <option value="published">published</option>}<option value="archived">archived</option></select></label>
            <label className={label}>Access<select name="access" defaultValue={l.access} className={field}><option value="public">Public</option><option value="members">Members</option><option value="premium">Premium</option><option value="advanced">Advanced (subscribers to this subject)</option></select></label>
            <label className={label}>Minutes<input name="estimated_minutes" type="number" min={1} max={600} defaultValue={l.estimated_minutes ?? ""} className={field} /></label>
            <label className={label}>Order<input name="sort_order" type="number" defaultValue={l.sort_order} className={field} /></label>
          </div>
          <label className={label}>Module<select name="module_id" defaultValue={l.module_id ?? ""} className={field}><option value="">No module</option>{(modules ?? []).map((m: { id: string; title: string }) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
          <div className="flex justify-end"><Submit>Save lesson</Submit></div>
        </form>
        <aside className="space-y-4">
          {course && <Link href={`/academy/courses/${course.slug}/${l.slug}`} className="block text-sm font-semibold text-accent-ink hover:underline">View public page →</Link>}
          {isAiConfigured() && (
            <form action={draftLessonSummary} className="rounded-xl border border-line bg-surface p-4">
              <input type="hidden" name="id" value={l.id} />
              <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-accent-ink" aria-hidden /> Draft summary with AI</p>
              <p className="mt-1 text-xs text-muted">Uses Claude Haiku on the saved lesson body only (well under a cent). Fills the summary and takeaways for you to review. Nothing is saved until you click Save lesson.</p>
              <div className="mt-2"><Submit size="sm" variant="secondary" pending="Drafting…">Draft summary</Submit></div>
            </form>
          )}
          <form action={setLessonResources} className="rounded-xl border border-line bg-surface p-4">
            <input type="hidden" name="lesson_id" value={l.id} />
            <p className="text-sm font-semibold">Lesson resources</p>
            <div className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
              {(resources ?? []).map((r: { id: string; title: string; creator_name: string | null; status: string }) => <label key={r.id} className="flex items-start gap-1.5"><input type="checkbox" name="resource_ids" value={r.id} defaultChecked={on.has(r.id)} className="mt-0.5" /><span>{r.title} <span className="text-muted">· {r.creator_name}{r.status !== "verified" ? " · not verified" : ""}</span></span></label>)}
            </div>
            <div className="mt-2"><Submit size="sm" variant="secondary">Save resources</Submit></div>
          </form>
          {admin && (
            <form action={deleteLesson} className="rounded-xl border border-danger/40 bg-surface p-4" data-testid="delete-lesson">
              <input type="hidden" name="id" value={l.id} />
              <p className="text-sm font-semibold">Delete this lesson</p>
              <p className="mt-1 text-xs text-muted">Removes it for good, with members&apos; progress on it. If it&apos;s still in the course&apos;s planned lessons, the weekly job writes a fresh version before release unless you remove it from the plan.</p>
              <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" name="drop_planned" defaultChecked className="mt-0.5" /> Also remove it from the planned lessons</label>
              <label className="mt-1 flex items-start gap-2 text-xs"><input type="checkbox" name="confirm" required className="mt-0.5" /> Yes, delete &quot;{l.title}&quot;</label>
              <div className="mt-2"><Submit size="sm" variant="danger" pending="Deleting…">Delete lesson</Submit></div>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
