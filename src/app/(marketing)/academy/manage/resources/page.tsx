import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { buttonClass } from "@/components/ui/button";
import { Submit } from "@/components/academy/controls";
import { StatusPill, field, label } from "../ui";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAcademyStaff, type Resource } from "@/lib/academy/server";
import { saveResource } from "../actions";

type Row = Resource & { status: string; license_id: string | null };
const KINDS = ["youtube", "skool_community", "skool_course", "official", "article", "template", "download"];
const SKILLS = ["getting_started", "sales", "estimating", "project_management", "accounting", "hr", "growth", "safety", "marketing"];

export default async function ManageResources({ searchParams }: PageProps<"/academy/manage/resources">) {
  const s = await requireAcademyStaff(["admin", "instructor"]);
  if (!s) notFound();
  const sp = await searchParams;
  const q = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const db = createAdminClient();
  let query = db.from("academy_resources").select("*").order("updated_at", { ascending: false }).limit(300);
  if (["candidate", "verified", "broken", "retired"].includes(q("status"))) query = query.eq("status", q("status"));
  const [{ data }, { data: licenses }] = await Promise.all([query, db.from("academy_creator_licenses").select("id, creator_name, status, expires_at").eq("status", "active").order("creator_name")]);
  const rows = (data ?? []) as Row[];
  const edit = q("edit") === "new" ? ({} as Partial<Row>) : rows.find((r) => r.id === q("edit")) ?? null;
  const admin = s.me.role === "admin";

  return (
    <>
      <Flash msg={q("msg") || undefined} err={q("err") || undefined} />
      <div className="rounded-xl border border-line bg-paper p-4 text-sm text-ink-soft">
        <p className="font-semibold text-ink">Import rules</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Only add resources you&apos;ve opened yourself. Record the real title, creator, link and the view count you saw, with today&apos;s date.</li>
          <li>Never copy, download or re-host videos, course lessons, posts or files. Link out and credit the creator. Write summaries in your own words.</li>
          <li>Only tick &quot;Embedding allowed&quot; when YouTube shows the video can be embedded. Never use content from behind a login.</li>
          <li>&quot;Licensed&quot; needs an active licence record with the creator&apos;s written permission. The database refuses it otherwise.</li>
        </ul>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5 text-sm">{["", "candidate", "verified", "broken", "retired"].map((x) => <Link key={x} href={x ? `/academy/manage/resources?status=${x}` : "/academy/manage/resources"} className={`rounded-full border px-3 py-1 ${q("status") === x ? "border-navy bg-navy text-white" : "border-line bg-surface"}`}>{x || "All"}</Link>)}</div>
        <Link href="/academy/manage/resources?edit=new" className={buttonClass("primary", "sm")}>Add resource</Link>
      </div>

      {edit && (
        <form action={saveResource} className="mt-4 grid gap-3 rounded-xl border border-line bg-surface p-5" data-testid="resource-form">
          <h2 className="font-bold">{edit.id ? "Edit resource" : "New resource"}</h2>
          {edit.id && <input type="hidden" name="id" value={edit.id} />}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={label}>Kind<select name="kind" defaultValue={edit.kind ?? "youtube"} className={field}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className={`${label} sm:col-span-2`}>Title (exactly as published)<input name="title" required maxLength={200} defaultValue={edit.title} className={field} /></label>
            <label className={label}>Creator<input name="creator_name" maxLength={120} defaultValue={edit.creator_name ?? ""} className={field} /></label>
            <label className={label}>Creator link (https)<input name="creator_url" type="url" maxLength={500} defaultValue={edit.creator_url ?? ""} className={field} /></label>
            <label className={label}>Community name<input name="community_name" maxLength={120} defaultValue={edit.community_name ?? ""} className={field} /></label>
            <label className={`${label} sm:col-span-2`}>Original link (https)<input name="source_url" type="url" required maxLength={500} defaultValue={edit.source_url} className={field} /></label>
            <label className={label}>Platform<input name="platform" maxLength={60} defaultValue={edit.platform ?? ""} placeholder="YouTube / Skool" className={field} /></label>
            <label className={label}>YouTube video id<input name="embed_id" pattern="[A-Za-z0-9_-]{6,20}" defaultValue={edit.embed_id ?? ""} className={field} /></label>
            <label className="flex items-center gap-2 pt-6 text-sm font-semibold"><input type="checkbox" name="embed_allowed" defaultChecked={edit.embed_allowed} /> Embedding allowed</label>
            <label className={label}>Views when verified<input name="views_at_verification" inputMode="numeric" defaultValue={edit.views_at_verification ?? ""} className={field} /></label>
            <label className={label}>Verified on<input name="verified_at" type="date" defaultValue={edit.verified_at ?? ""} className={field} /></label>
            <label className={label}>Skill<select name="skill" defaultValue={edit.skill ?? ""} className={field}><option value="">—</option>{SKILLS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className={label}>Trades (comma-separated slugs, blank = all)<input name="trades" defaultValue={(edit.trades ?? []).join(", ")} className={field} /></label>
          </div>
          <label className={label}>Built2Bid summary (your own words)<textarea name="summary" maxLength={800} rows={3} defaultValue={edit.summary ?? ""} className={field} /></label>
          <label className={label}>Why it matters<textarea name="why_it_matters" maxLength={600} rows={2} defaultValue={edit.why_it_matters ?? ""} className={field} /></label>
          <label className={label}>Takeaways (one per line)<textarea name="takeaways" rows={3} defaultValue={(edit.takeaways ?? []).join("\n")} className={field} /></label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={label}>Access note<input name="access_note" maxLength={200} defaultValue={edit.access_note ?? ""} placeholder="Free to join / Paid membership" className={field} /></label>
            <label className={label}>Permission<select name="permission_status" defaultValue={edit.permission_status ?? "link_only"} className={field}><option value="link_only">Link only (credited)</option><option value="licensed">Licensed</option><option value="original">Built2Bid original</option></select></label>
            <label className={label}>Licence record<select name="license_id" defaultValue={edit.license_id ?? ""} className={field}><option value="">—</option>{(licenses ?? []).map((l: { id: string; creator_name: string; expires_at: string | null }) => <option key={l.id} value={l.id}>{l.creator_name}{l.expires_at ? ` (until ${l.expires_at})` : ""}</option>)}</select></label>
            <label className={label}>Status<select name="status" defaultValue={edit.status ?? "candidate"} className={field}><option value="candidate">candidate</option>{(admin || edit.status === "verified") && <option value="verified">verified</option>}<option value="broken">broken</option><option value="retired">retired</option></select></label>
            <label className={`${label} sm:col-span-2`}>Verification note<input name="verification_note" maxLength={300} defaultValue={edit.verification_note ?? ""} className={field} /></label>
          </div>
          <div className="flex justify-end gap-2"><Link href="/academy/manage/resources" className={buttonClass("ghost", "md")}>Cancel</Link><Submit>Save resource</Submit></div>
        </form>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-paper text-left text-xs text-muted"><tr><th className="p-2">Resource</th><th className="p-2">Creator</th><th className="p-2">Kind</th><th className="p-2">Permission</th><th className="p-2">Status</th><th className="p-2">Verified</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="p-2"><Link href={`/academy/manage/resources?edit=${r.id}`} className="font-semibold hover:underline">{r.title}</Link> <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted underline">open</a></td>
                <td className="p-2">{r.creator_name}</td><td className="p-2">{r.kind}</td><td className="p-2">{r.permission_status}</td>
                <td className="p-2"><StatusPill status={r.status} /></td><td className="p-2 text-xs">{r.verified_at ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
