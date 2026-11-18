import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { StatusPill, field, label } from "../ui";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";
import { saveLicense } from "../actions";

type Lic = { id: string; creator_name: string; creator_contact_note: string | null; permission_date: string; authorized_content: string; permitted_uses: string; commercial_use: boolean; attribution_requirements: string | null; expires_at: string | null; source_documentation: string | null; status: string };

export default async function ManageLicenses({ searchParams }: PageProps<"/academy/manage/licenses">) {
  if (!(await requireAcademyStaff(["admin"]))) notFound();
  const sp = await searchParams;
  const { data } = await createAdminClient().from("academy_creator_licenses").select("*").order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as Lic[];
  return (
    <>
      <Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} />
      <p className="text-sm text-ink-soft">Record a licence only after the creator has given written permission. A resource can be marked &quot;Licensed&quot; only while its licence is active and unexpired.</p>
      <details className="mt-4 rounded-xl border border-line bg-surface p-5"><summary className="cursor-pointer font-bold">Record a new licence</summary><div className="mt-3"><LicForm /></div></details>
      <ul className="mt-4 space-y-3">
        {rows.length === 0 && <li className="text-sm text-muted">No licences recorded. Every current resource is link-only with credit.</li>}
        {rows.map((l) => (
          <li key={l.id}><details className="rounded-xl border border-line bg-surface p-4"><summary className="cursor-pointer"><span className="font-semibold">{l.creator_name}</span> <StatusPill status={l.status} /> <span className="text-xs text-muted">granted {l.permission_date}{l.expires_at ? ` · expires ${l.expires_at}` : ""}{l.commercial_use ? " · commercial" : ""}</span></summary><div className="mt-3"><LicForm l={l} /></div></details></li>
        ))}
      </ul>
    </>
  );
}

function LicForm({ l }: { l?: Lic }) {
  return (
    <form action={saveLicense} className="grid gap-3">
      {l && <input type="hidden" name="id" value={l.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>Creator<input name="creator_name" required minLength={2} maxLength={120} defaultValue={l?.creator_name} className={field} /></label>
        <label className={label}>Permission date<input name="permission_date" type="date" required defaultValue={l?.permission_date} className={field} /></label>
        <label className={label}>Expires (optional)<input name="expires_at" type="date" defaultValue={l?.expires_at ?? ""} className={field} /></label>
      </div>
      <label className={label}>Authorized content<textarea name="authorized_content" required maxLength={2000} rows={2} defaultValue={l?.authorized_content} className={field} /></label>
      <label className={label}>Permitted uses<textarea name="permitted_uses" required maxLength={2000} rows={2} defaultValue={l?.permitted_uses} className={field} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Attribution requirements<input name="attribution_requirements" maxLength={1000} defaultValue={l?.attribution_requirements ?? ""} className={field} /></label>
        <label className={label}>Where the written permission is kept<input name="source_documentation" maxLength={1000} defaultValue={l?.source_documentation ?? ""} placeholder="e.g. signed PDF in Drive > Legal > Licences" className={field} /></label>
        <label className={label}>Contact note (no personal phone numbers)<input name="creator_contact_note" maxLength={300} defaultValue={l?.creator_contact_note ?? ""} className={field} /></label>
        <label className={label}>Status<select name="status" defaultValue={l?.status ?? "active"} className={field}><option>active</option><option>expired</option><option>revoked</option></select></label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="commercial_use" defaultChecked={l?.commercial_use} /> Commercial use permitted</label>
      <div><Submit size="sm">{l ? "Save changes" : "Record licence"}</Submit></div>
    </form>
  );
}
