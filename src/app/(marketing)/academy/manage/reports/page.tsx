import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { timeAgo } from "@/components/academy/format";
import { field } from "../ui";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";
import { REPORT_REASONS } from "@/lib/academy/types";
import { resolveReport } from "../actions";

type Rep = { id: string; reporter_id: string; target_type: string; target_id: string; reason: string; details: string | null; status: string; created_at: string; resolution_note: string | null };

export default async function ManageReports({ searchParams }: PageProps<"/academy/manage/reports">) {
  if (!(await requireAcademyStaff(["admin", "moderator"]))) notFound();
  const sp = await searchParams;
  const status = sp.status === "closed" ? "closed" : "open";
  const db = createAdminClient();
  let q = db.from("academy_reports").select("*").order("created_at", { ascending: status === "open" }).limit(100);
  q = status === "open" ? q.eq("status", "open") : q.neq("status", "open");
  const { data } = await q;
  const reps = (data ?? []) as Rep[];
  const ids = (t: string) => [...new Set(reps.filter((r) => r.target_type === t).map((r) => r.target_id))];
  const [posts, comments] = await Promise.all([
    ids("post").length ? db.from("academy_posts").select("id, title, body, status, author_id").in("id", ids("post")) : Promise.resolve({ data: [] }),
    ids("comment").length ? db.from("academy_comments").select("id, post_id, body, status, author_id").in("id", ids("comment")) : Promise.resolve({ data: [] }),
  ]);
  const people = [...new Set([...reps.map((r) => r.reporter_id), ...ids("member"), ...((posts.data ?? []) as { author_id: string }[]).map((p) => p.author_id), ...((comments.data ?? []) as { author_id: string }[]).map((c) => c.author_id)])];
  const { data: members } = people.length ? await db.from("academy_members").select("user_id, display_name").in("user_id", people) : { data: [] };
  const name = new Map(((members ?? []) as { user_id: string; display_name: string }[]).map((m) => [m.user_id, m.display_name]));
  const post = new Map(((posts.data ?? []) as { id: string; title: string; body: string; status: string; author_id: string }[]).map((p) => [p.id, p]));
  const comment = new Map(((comments.data ?? []) as { id: string; post_id: string; body: string; status: string; author_id: string }[]).map((c) => [c.id, c]));
  const reason = new Map(REPORT_REASONS.map((r) => [r.key, r.label]));

  return (
    <>
      <Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} />
      <div className="flex gap-1.5 text-sm">
        <Link href="/academy/manage/reports" className={`rounded-full border px-3 py-1 ${status === "open" ? "border-navy bg-navy text-white" : "border-line bg-surface"}`}>Open</Link>
        <Link href="/academy/manage/reports?status=closed" className={`rounded-full border px-3 py-1 ${status === "closed" ? "border-navy bg-navy text-white" : "border-line bg-surface"}`}>Closed</Link>
      </div>
      <ul className="mt-4 space-y-3" data-testid="reports">
        {reps.length === 0 && <li className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-center text-sm text-ink-soft">{status === "open" ? "No open reports." : "No closed reports yet."}</li>}
        {reps.map((r) => {
          const p = r.target_type === "post" ? post.get(r.target_id) : null;
          const c = r.target_type === "comment" ? comment.get(r.target_id) : null;
          const href = p ? `/academy/post/${p.id}` : c ? `/academy/post/${c.post_id}#c-${c.id}` : r.target_type === "member" ? `/academy/members/${r.target_id}` : null;
          return (
            <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-muted">{reason.get(r.reason as never) ?? r.reason} · reported by {name.get(r.reporter_id) ?? "a member"} · {timeAgo(r.created_at)}{r.status !== "open" ? ` · ${r.status}` : ""}</p>
              <p className="mt-1 text-sm font-semibold">
                {r.target_type === "post" ? `Post: ${p?.title ?? "(deleted)"}` : r.target_type === "comment" ? "Comment" : `Member: ${name.get(r.target_id) ?? "(unknown)"}`}
                {(p || c) && <span className="ml-1 text-xs font-normal text-muted">by {name.get((p ?? c)!.author_id) ?? "a member"} · {(p ?? c)!.status}</span>}
              </p>
              {(p || c) && <p className="mt-1 line-clamp-3 text-sm text-ink-soft">{(p?.body ?? c?.body) || ""}</p>}
              {r.details && <p className="mt-1 text-sm"><span className="font-semibold">Reporter&apos;s note: </span>{r.details}</p>}
              {href && <Link href={href} className="mt-1 inline-block text-xs font-semibold text-accent-ink underline">Open</Link>}
              {r.status !== "open" && r.resolution_note && <p className="mt-2 text-xs text-muted">Resolution: {r.resolution_note}</p>}
              {r.status === "open" && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <form action={resolveReport} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="report_id" value={r.id} /><input type="hidden" name="target_type" value={r.target_type} /><input type="hidden" name="target_id" value={r.target_id} />
                    <input type="hidden" name="status" value="actioned" />
                    {(p || c) && <input type="hidden" name="hide" value="1" />}
                    <input name="note" maxLength={1000} placeholder="Note (optional)" aria-label="Resolution note" className={`${field} max-w-xs`} />
                    <Submit size="sm" variant={p || c ? "danger" : "secondary"} pending="Saving…">{p || c ? "Hide content" : "Mark actioned"}</Submit>
                  </form>
                  <form action={resolveReport}>
                    <input type="hidden" name="report_id" value={r.id} /><input type="hidden" name="status" value="dismissed" />
                    <Submit size="sm" variant="ghost" pending="Saving…">Dismiss</Submit>
                  </form>
                  {r.target_type === "member" && <Link href={`/academy/manage/members?user=${r.target_id}`} className="text-xs font-semibold text-accent-ink underline">Suspend or ban</Link>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
