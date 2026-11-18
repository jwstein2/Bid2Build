import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";

type Row = { id: number; actor_id: string | null; action: string; target_type: string; target_id: string | null; details: Record<string, unknown> | null; created_at: string };

export default async function ManageAudit() {
  if (!(await requireAcademyStaff(["admin"]))) notFound();
  const db = createAdminClient();
  const { data } = await db.from("academy_audit_log").select("*").order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as Row[];
  const actors = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => Boolean(x)))];
  const { data: names } = actors.length ? await db.from("academy_members").select("user_id, display_name").in("user_id", actors) : { data: [] };
  const name = new Map(((names ?? []) as { user_id: string; display_name: string }[]).map((n) => [n.user_id, n.display_name]));
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-paper text-left text-xs text-muted"><tr><th className="p-2">When (UTC)</th><th className="p-2">Who</th><th className="p-2">Action</th><th className="p-2">Target</th><th className="p-2">Details</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">Nothing logged yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="p-2 whitespace-nowrap text-xs">{r.created_at.slice(0, 16).replace("T", " ")}</td>
              <td className="p-2">{r.actor_id ? name.get(r.actor_id) ?? r.actor_id.slice(0, 8) : "system"}</td>
              <td className="p-2 font-mono text-xs">{r.action}</td>
              <td className="p-2 text-xs">{r.target_type}{r.target_id ? ` · ${r.target_id.slice(0, 8)}` : ""}</td>
              <td className="max-w-md p-2 font-mono text-[11px] break-words text-muted">{r.details ? JSON.stringify(r.details).slice(0, 300) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
