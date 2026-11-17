import { Chip, Panel, Row } from "@/components/admin/cc";
import { commConfig, replyMonitoring } from "@/lib/comms/config";
import { sendCommsInboundTest, setCommsPaused } from "@/app/admin/operations/actions";
import type { createAdminClient } from "@/lib/supabase/server";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Owner panel: customer communications sending state, reply monitoring and the emergency stop. */
export async function CommsOpsPanel({ db, note }: { db: ReturnType<typeof createAdminClient>; note: string | null }) {
  const cfg = commConfig();
  const [{ data: g }, { count: queued }, { count: sent }, { count: failed }] = await Promise.all([
    db.from("comm_global").select("paused, paused_at, inbound_verified_at").eq("id", 1).maybeSingle(),
    db.from("comm_messages").select("id", { count: "exact", head: true }).in("status", ["awaiting_review", "scheduled", "approved"]),
    db.from("comm_messages").select("id", { count: "exact", head: true }).gte("sent_at", daysAgo(7)),
    db.from("comm_messages").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);
  if (!g) return <Panel title="Customer communications" id="comms"><p className="text-sm text-ink-soft">Run SQL 20261121001000_customer_communications.sql to enable this panel.</p></Panel>;
  const mon = replyMonitoring(cfg, (g.inbound_verified_at as string | null) ?? null);
  const btn = "cc-mono rounded-md border border-[var(--cc-line)] px-3 py-1.5 text-xs text-white hover:border-[var(--cc-blue)]";
  return (
    <Panel title="Customer communications" id="comms">
      <dl>
        <Row k="Sending">{g.paused ? <Chip tone="red">Emergency stop ON</Chip> : cfg.enabled ? <Chip tone={cfg.mode === "live" ? "green" : "amber"}>{cfg.mode}</Chip> : <Chip tone="muted">off</Chip>}</Row>
        <Row k="Reply monitoring">{mon.active ? <Chip tone="green">Active</Chip> : <Chip tone="amber">Not active</Chip>}</Row>
        <Row k="Queued / sent 7d / failed">{`${queued ?? 0} / ${sent ?? 0} / ${failed ?? 0}`}</Row>
      </dl>
      {!cfg.enabled && <p className="mt-2 text-xs text-muted">{cfg.reason}</p>}
      {!mon.active && <p className="mt-1 text-xs text-muted">{mon.reason}</p>}
      {note && <p className="mt-2 text-xs" role="status">{note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <form action={setCommsPaused}><input type="hidden" name="paused" value={g.paused ? "0" : "1"} /><button type="submit" className={btn} data-testid="comms-emergency">{g.paused ? "Lift emergency stop" : "Emergency stop: pause all customer emails"}</button></form>
        {cfg.replyDomain && <form action={sendCommsInboundTest}><button type="submit" className={btn}>Send reply-monitoring test</button></form>}
      </div>
    </Panel>
  );
}
