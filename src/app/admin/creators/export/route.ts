import { requireAdmin } from "@/lib/admin/server";
import { EXPORT_COLUMNS } from "@/lib/creator/crm";
import { toCsv } from "@/lib/creator/outreach/csv";

export const runtime = "nodejs";

/** Owner-only CSV export of the creator research + outreach tracker. */
export async function GET() {
  const { user, db } = await requireAdmin();
  const { data, error } = await db.from("creator_prospects").select(EXPORT_COLUMNS.join(",")).order("waitlist").order("rank", { ascending: true, nullsFirst: false }).limit(5000);
  if (error) return new Response("Not available", { status: 503 });
  await db.from("audit_logs").insert({ actor_id: user.id, action: "creator_crm.export", target_type: "creator_prospects", target_id: "csv", details: { rows: data?.length ?? 0 } });
  const csv = toCsv([...EXPORT_COLUMNS], (data ?? []) as unknown as Record<string, unknown>[]);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="built2bid-creator-partnerships-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
