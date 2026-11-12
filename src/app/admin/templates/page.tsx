import Link from "next/link";
import { Badge, Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { trades } from "@/lib/trades/catalog";

export const dynamic = "force-dynamic";

export default async function AdminTemplates() {
  const { db } = await requireAdmin();
  const { data } = await db.from("trade_templates").select("trade_slug, version, published");
  const latest = new Map<string, { version: number; published: number | null }>();
  for (const r of data ?? []) {
    const cur = latest.get(r.trade_slug) ?? { version: 0, published: null };
    cur.version = Math.max(cur.version, r.version);
    if (r.published) cur.published = Math.max(cur.published ?? 0, r.version);
    latest.set(r.trade_slug, cur);
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Trade templates</h1>
        <p className="mt-1 text-sm text-ink-soft">Every save creates a new version. New bids start from the latest published version; existing bids are never changed. Templates never contain prices.</p>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2">Trade</th><th className="px-4 py-2">Family</th><th className="px-4 py-2">Live version</th><th className="px-4 py-2">Latest</th><th /></tr></thead>
          <tbody>
            {trades.map((t) => {
              const l = latest.get(t.slug);
              return (
                <tr key={t.slug} className="border-t border-line">
                  <td className="px-4 py-2 font-semibold">{t.name}</td>
                  <td className="px-4 py-2 text-ink-soft">{t.family}</td>
                  <td className="px-4 py-2">{l?.published ? <Badge tone="ok">v{l.published}</Badge> : <Badge>Built-in v{t.template.version}</Badge>}</td>
                  <td className="px-4 py-2 text-ink-soft">{l ? `v${l.version}` : "—"}</td>
                  <td className="px-4 py-2 text-right"><Link className="font-semibold text-brand underline" href={`/admin/templates/${t.slug}`}>Edit</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
