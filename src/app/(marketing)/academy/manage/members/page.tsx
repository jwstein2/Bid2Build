import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { buttonClass } from "@/components/ui/button";
import { Submit } from "@/components/academy/controls";
import { ROLE_LABEL, timeAgo } from "@/components/academy/format";
import { StatusPill, field } from "../ui";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";
import { setMember } from "../actions";

type M = { user_id: string; display_name: string; role: string; tier: string; status: string; suspended_until: string | null; joined_at: string; last_seen_at: string | null; primary_trade: string | null };

export default async function ManageMembers({ searchParams }: PageProps<"/academy/manage/members">) {
  const s = await requireAcademyStaff(["admin", "moderator"]);
  if (!s) notFound();
  const sp = await searchParams;
  const q = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 80) : "");
  let query = createAdminClient().from("academy_members").select("user_id, display_name, role, tier, status, suspended_until, joined_at, last_seen_at, primary_trade").order("joined_at", { ascending: false }).limit(100);
  if (/^[0-9a-f-]{36}$/i.test(q("user"))) query = query.eq("user_id", q("user"));
  else if (q("q")) query = query.ilike("display_name", `%${q("q").replace(/[%_]/g, "")}%`);
  if (["active", "suspended", "banned", "left"].includes(q("status"))) query = query.eq("status", q("status"));
  if (["admin", "moderator", "instructor"].includes(q("role"))) query = query.eq("role", q("role"));
  const { data } = await query;
  const rows = (data ?? []) as M[];
  const admin = s.me.role === "admin";
  const here = `/academy/manage/members?${new URLSearchParams(Object.entries({ q: q("q"), user: q("user"), status: q("status"), role: q("role") }).filter(([, v]) => v))}`;

  return (
    <>
      <Flash msg={q("msg") || undefined} err={q("err") || undefined} />
      <form className="flex flex-wrap items-end gap-2" action="/academy/manage/members">
        <input name="q" defaultValue={q("q")} placeholder="Search display names" className={`${field} w-56`} />
        <select name="status" defaultValue={q("status")} className={`${field} w-36`}><option value="">Any status</option><option>active</option><option>suspended</option><option>banned</option><option>left</option></select>
        <select name="role" defaultValue={q("role")} className={`${field} w-36`}><option value="">Any role</option><option value="admin">Admins</option><option value="moderator">Moderators</option><option value="instructor">Instructors</option></select>
        <button className={buttonClass("secondary", "sm", "mb-0.5")}>Filter</button>
      </form>
      <p className="mt-3 text-xs text-muted">Moderators can suspend and restore members. Only Academy admins can ban or change roles and premium access. Company admins on the Team plan have no Academy role unless granted here; platform super-admins are always Academy admins.</p>
      <ul className="mt-3 space-y-2" data-testid="manage-members">
        {rows.length === 0 && <li className="text-sm text-muted">No members match.</li>}
        {rows.map((m) => (
          <li key={m.user_id} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/academy/members/${m.user_id}`} className="font-semibold hover:underline">{m.display_name}</Link>
              <StatusPill status={m.status} />
              <span className="text-xs text-muted">{ROLE_LABEL[m.role]} · {m.tier} · joined {timeAgo(m.joined_at)}{m.last_seen_at ? ` · seen ${timeAgo(m.last_seen_at)}` : ""}{m.suspended_until && m.status === "suspended" ? ` · until ${m.suspended_until.slice(0, 10)}` : ""}</span>
            </div>
            <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-accent-ink">Change</summary>
              <form action={setMember} className="mt-2 grid gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
                <input type="hidden" name="user_id" value={m.user_id} /><input type="hidden" name="return_to" value={here} />
                <label className="text-xs font-semibold">Status<select name="status" defaultValue="" className={field}><option value="">No change</option><option value="active">Active (restore)</option><option value="suspended">Suspend</option>{admin && <option value="banned">Ban</option>}</select></label>
                <label className="text-xs font-semibold">Suspend until<input type="date" name="suspended_until" className={field} /></label>
                {admin ? (
                  <>
                    <label className="text-xs font-semibold">Role<select name="role" defaultValue="" className={field}><option value="">No change</option><option value="member">Member</option><option value="instructor">Instructor</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select></label>
                    <label className="text-xs font-semibold">Tier<select name="tier" defaultValue="" className={field}><option value="">No change</option><option value="free">Free</option><option value="premium">Premium (complimentary)</option></select></label>
                  </>
                ) : <span className="sm:col-span-2" />}
                <label className="text-xs font-semibold sm:col-span-4">Reason (kept in the audit log)<input name="note" maxLength={500} className={field} /></label>
                <Submit size="sm">Apply</Submit>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
