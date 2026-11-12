import { Badge, Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { setFlag } from "../actions";

export const dynamic = "force-dynamic";

export default async function Flags() {
  const { db } = await requireAdmin();
  const { data } = await db.from("feature_flags").select("key, enabled, description, updated_at").order("key");
  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-extrabold">Feature flags</h1><p className="mt-1 text-sm text-ink-soft">Every change is recorded in the audit log.</p></div>
      <Card>
        {!data?.length ? <p className="p-4 text-sm text-muted">No flags. Run supabase/seed.sql.</p> : (
          <ul>
            {data.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 first:border-t-0">
                <div><p className="font-mono text-sm font-semibold">{f.key} {f.enabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}</p><p className="text-xs text-ink-soft">{f.description}</p></div>
                <form action={setFlag.bind(null, f.key, !f.enabled)}><button className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-paper">{f.enabled ? "Turn off" : "Turn on"}</button></form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
