import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { fail, json } from "@/lib/http/api";
import { commConfig, replyMonitoring } from "@/lib/comms/config";
import { loadCommAccess, loadOffers, loadSettings } from "@/lib/comms/server";

export const runtime = "nodejs";

/** Communications overview for the signed-in account: settings, status, queue, history, replies, contacts. */
export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  const supabase = await createClient();
  const access = await loadCommAccess(supabase);
  if (!access) return json({ available: false });
  if (!access.pm || !access.accountId || !access.perms.includes("view_communications")) return json({ available: true, access, locked: true });
  const accountId = access.accountId;
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [settings, offers, { data: messages }, { data: events }, { data: contacts }, { data: projects }] = await Promise.all([
    loadSettings(supabase, accountId),
    loadOffers(supabase, accountId),
    supabase.from("comm_messages").select("id, kind, trigger, contact_id, customer_id, estimate_id, schedule_id, to_email, to_name, subject, body_text, status, status_reason, scheduled_for, sent_at, delivered_at, replied_at, approved_by, approved_at, automation, initiated_by, template_version, provider_id, offer_id, created_at")
      .eq("account_id", accountId).or(`status.in.(awaiting_review,scheduled,approved,sending,failed,paused),created_at.gte.${since}`).order("created_at", { ascending: false }).limit(500),
    supabase.from("comm_events").select("id, kind, message_id, contact_id, from_email, subject, excerpt, details, needs_attention, handled_at, created_at, actor_id")
      .eq("account_id", accountId).gte("created_at", since).order("created_at", { ascending: false }).limit(300),
    supabase.from("comm_contacts").select("id, email, name, customer_id, status, status_reason, basis, enrolled_at, last_nurture_at, last_reply_at").eq("account_id", accountId).order("name").limit(2000),
    supabase.from("project_comm_settings").select("schedule_id, frequency, mode, paused_at, recipient_email").eq("account_id", accountId),
  ]);
  const cfg = commConfig();
  // Global switch + reply verification are platform facts (no customer data): read with the service role.
  const { data: global } = await createAdminClient().from("comm_global").select("paused, inbound_verified_at").eq("id", 1).maybeSingle();
  const monitoring = replyMonitoring(cfg, (global as { inbound_verified_at?: string | null } | null)?.inbound_verified_at ?? null);
  const scheduleIds = ((projects ?? []) as { schedule_id: string }[]).map((p) => p.schedule_id);
  const { data: schedules } = scheduleIds.length ? await supabase.from("project_schedules").select("id, name, status").in("id", scheduleIds) : { data: [] };
  return json({
    available: true, locked: false, access, settings, offers, messages: messages ?? [], events: events ?? [], contacts: contacts ?? [],
    projects: ((projects ?? []) as Record<string, unknown>[]).map((p) => ({ ...p, name: ((schedules ?? []) as { id: string; name: string; status: string }[]).find((s) => s.id === p.schedule_id)?.name ?? "Project", scheduleStatus: ((schedules ?? []) as { id: string; status: string }[]).find((s) => s.id === p.schedule_id)?.status ?? null })),
    platform: { sending: cfg.enabled ? cfg.mode : "off", sendingReason: cfg.reason, paused: Boolean((global as { paused?: boolean } | null)?.paused), monitoring },
  });
}
