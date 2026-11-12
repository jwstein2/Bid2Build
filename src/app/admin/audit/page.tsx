import { Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

export default async function Audit() {
  const { db } = await requireAdmin();
  const { data } = await db.from("audit_logs").select("id, actor_id, action, target_type, target_id, details, created_at").order("id", { ascending: false }).limit(200);
  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-extrabold">Audit log</h1><p className="mt-1 text-sm text-ink-soft">Latest 200 admin actions. Append-only; not editable from the app.</p></div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">When (UTC)</th><th className="px-4 py-2">Actor</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Target</th><th className="px-4 py-2">Details</th></tr></thead>
          <tbody>{!data?.length ? <tr><td colSpan={5} className="px-4 py-3 text-muted">No admin actions yet.</td></tr> : data.map((r) => (
            <tr key={r.id} className="border-t border-line align-top">
              <td className="whitespace-nowrap px-4 py-2 text-xs">{new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}</td>
              <td className="px-4 py-2 font-mono text-xs">{r.actor_id?.slice(0, 8) ?? "—"}</td>
              <td className="px-4 py-2 font-semibold">{r.action}</td>
              <td className="px-4 py-2 text-xs">{r.target_type}: {r.target_id}</td>
              <td className="px-4 py-2 font-mono text-xs text-ink-soft">{r.details ? JSON.stringify(r.details).slice(0, 200) : ""}</td>
            </tr>
          ))}</tbody></table>
      </Card>
    </div>
  );
}
