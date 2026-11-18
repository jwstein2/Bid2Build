import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { buttonClass } from "@/components/ui/button";
import { StatusPill, field } from "../ui";
import { createAdminClient } from "@/lib/supabase/server";
import { listTrades, requireAcademyStaff } from "@/lib/academy/server";
import { PILLARS, pillarMeta } from "@/lib/academy/types";

const STATUSES = ["draft", "upcoming", "in_review", "published", "archived"];

export default async function ManageCourses({ searchParams }: PageProps<"/academy/manage/courses">) {
  if (!(await requireAcademyStaff(["admin", "instructor"]))) notFound();
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const trades = await listTrades();
  const tradeName = new Map(trades.map((t) => [t.slug, t.name]));
  let q = createAdminClient().from("academy_courses").select("id, slug, title, trade_slug, pillar, status, access, featured, sort_order, updated_at").order("trade_slug", { nullsFirst: true }).order("sort_order").limit(400);
  if (s("trade") === "_all") q = q.is("trade_slug", null); else if (tradeName.has(s("trade"))) q = q.eq("trade_slug", s("trade"));
  if (STATUSES.includes(s("status"))) q = q.eq("status", s("status"));
  if (PILLARS.some((p) => p.key === s("pillar"))) q = q.eq("pillar", s("pillar"));
  if (s("q")) q = q.ilike("title", `%${s("q").replace(/[%_]/g, "").slice(0, 60)}%`);
  const { data } = await q;
  const rows = (data ?? []) as { id: string; slug: string; title: string; trade_slug: string | null; pillar: string; status: string; access: string; featured: boolean; sort_order: number; updated_at: string }[];
  return (
    <>
      <Flash msg={s("msg") || undefined} err={s("err") || undefined} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2" action="/academy/manage/courses">
          <input name="q" defaultValue={s("q")} placeholder="Search titles" className={`${field} w-48`} />
          <select name="trade" defaultValue={s("trade")} className={`${field} w-44`}><option value="">Any trade</option><option value="_all">Every trade (general)</option>{trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select>
          <select name="pillar" defaultValue={s("pillar")} className={`${field} w-40`}><option value="">Any pillar</option>{PILLARS.map((p) => <option key={p.key} value={p.key}>{p.short}</option>)}</select>
          <select name="status" defaultValue={s("status")} className={`${field} w-36`}><option value="">Any status</option>{STATUSES.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select>
          <button className={buttonClass("secondary", "sm", "mb-0.5")}>Filter</button>
        </form>
        <Link href="/academy/manage/courses/new" className={buttonClass("primary", "sm")}>New course</Link>
      </div>
      <p className="mt-3 text-xs text-muted">{rows.length} courses{rows.length === 400 ? " (first 400; narrow the filters)" : ""}</p>
      <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-paper text-left text-xs text-muted"><tr><th className="p-2">Course</th><th className="p-2">Trade</th><th className="p-2">Pillar</th><th className="p-2">Status</th><th className="p-2">Access</th><th className="p-2">Order</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="p-2"><Link href={`/academy/manage/courses/${c.id}`} className="font-semibold hover:underline">{c.title}</Link>{c.featured && <span className="ml-1 text-xs text-accent-ink">★</span>}<span className="block text-xs text-muted">/{c.slug}</span></td>
                <td className="p-2">{c.trade_slug ? tradeName.get(c.trade_slug) ?? c.trade_slug : "Every trade"}</td>
                <td className="p-2">{pillarMeta(c.pillar).short}</td>
                <td className="p-2"><StatusPill status={c.status} /></td>
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
