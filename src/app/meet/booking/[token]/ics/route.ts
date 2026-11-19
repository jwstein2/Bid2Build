import { createAdminClient } from "@/lib/supabase/server";
import { agendaFor, hashToken, icsInvite, SESSIONS, type SessionId } from "@/lib/sales/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new Response("Not found", { status: 404 });
  const { data } = await createAdminClient().rpc("sales_booking_by_token", { p_token_hash: hashToken(token) });
  const b = data as { id: string; session: SessionId; starts_at: string; ends_at: string; status: string; plan: string | null; rep_first_name: string; meeting_link: string | null } | null;
  if (!b) return new Response("Not found", { status: 404 });
  const body = icsInvite({ uid: b.id, start: b.starts_at, end: b.ends_at, summary: `${SESSIONS[b.session].title} with ${b.rep_first_name} (Built2Bid)`,
    description: agendaFor(b.session, b.plan).map((a) => `- ${a}`).join("\n"), location: b.meeting_link, canceled: b.status === "canceled" });
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": "attachment; filename=built2bid-session.ics", "cache-control": "no-store" } });
}
