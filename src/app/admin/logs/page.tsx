import { Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";

export const dynamic = "force-dynamic";
const fmt = (s: string) => new Date(s).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";

export default async function Logs() {
  const { db } = await requireAdmin();
  const [{ data: imports }, { data: pdfs }] = await Promise.all([
    db.from("import_logs").select("id, url_host, status, error_code, created_at").neq("status", "success").order("created_at", { ascending: false }).limit(100),
    db.from("pdf_errors").select("id, estimate_id, error, created_at").order("created_at", { ascending: false }).limit(100),
  ]);
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-extrabold">Import &amp; PDF errors</h1>
      <section>
        <h2 className="font-display text-lg font-bold">Website import problems</h2>
        <p className="text-xs text-muted">Only the host name and an error code are stored.</p>
        <Card className="mt-2 overflow-x-auto">
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Host</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Code</th></tr></thead>
            <tbody>{!imports?.length ? <tr><td colSpan={4} className="px-4 py-3 text-muted">None.</td></tr> : imports.map((r) => (
              <tr key={r.id} className="border-t border-line"><td className="px-4 py-2 text-xs">{fmt(r.created_at)}</td><td className="px-4 py-2">{r.url_host ?? "—"}</td><td className="px-4 py-2">{r.status}</td><td className="px-4 py-2 font-mono text-xs">{r.error_code ?? ""}</td></tr>
            ))}</tbody></table>
        </Card>
      </section>
      <section>
        <h2 className="font-display text-lg font-bold">PDF generation errors</h2>
        <Card className="mt-2 overflow-x-auto">
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Estimate</th><th className="px-4 py-2">Error</th></tr></thead>
            <tbody>{!pdfs?.length ? <tr><td colSpan={3} className="px-4 py-3 text-muted">None.</td></tr> : pdfs.map((r) => (
              <tr key={r.id} className="border-t border-line"><td className="px-4 py-2 text-xs">{fmt(r.created_at)}</td><td className="px-4 py-2 font-mono text-xs">{r.estimate_id?.slice(0, 8) ?? "—"}</td><td className="px-4 py-2 text-xs">{r.error.slice(0, 300)}</td></tr>
            ))}</tbody></table>
        </Card>
      </section>
    </div>
  );
}
