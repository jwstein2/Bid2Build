import { Chip, Empty, FunnelSteps, Kpi, PageHead, Panel, Table, fmt } from "@/components/admin/cc";
import { requireAdmin } from "@/lib/admin/server";
import { trialConfig, TRIAL_DAYS } from "@/lib/trial/config";
import { metaReadiness } from "@/lib/trial/readiness";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facebook BID trial" };

type Funnel = {
  qualifying_comments: number; private_replies_sent: number; private_replies_failed: number; messenger_interactions: number;
  reminders_sent: number; opt_outs: number; invites_requested: number; invites_sent: number; invite_emails_failed: number;
  trials_activated: number; trials_active_now: number; first_bid_finalized: number; first_paid_upgrade: number;
  by_source: Record<string, number>; by_post: { post_id: string; comments: number; replied: number; last_at: string }[];
  reply_formats: Record<string, number>; last_errors: { kind: string; error: string; at: string }[];
};

/**
 * Owner view of the Facebook "comment BID" funnel: live Meta readiness checks and counts. Organic
 * test posts and paid ad posts are verified separately: a passing organic test says nothing about
 * the ad placement.
 */
export default async function FacebookTrialAdmin() {
  const { user, db } = await requireAdmin();
  const cfg = trialConfig();
  const [{ data, error }, ready] = await Promise.all([db.rpc("trial_campaign_funnel", { p_caller: user.id }), metaReadiness(cfg)]);
  const f = (error ? null : data) as Funnel | null;
  const step = (label: string, n: number | undefined) => ({ label, n: n ?? null });
  const byPost = new Map((f?.by_post ?? []).map((p) => [p.post_id, p]));

  return (
    <div className="space-y-6">
      <PageHead kicker="Marketing · Facebook comment-to-trial" title="Comment BID → free week"
        intro={`Comment BID on the Built2Bid post → private Messenger reply → email invite → ${TRIAL_DAYS} free days of Unlimited after verified sign-in. No card, no charge.`}
        right={<Chip tone={cfg.enabled ? "green" : "amber"}>{cfg.enabled ? "Campaign ON" : "Campaign paused"}</Chip>} />

      {!f ? <Empty>Funnel numbers unavailable: run the migration 20261116008000_facebook_trial_funnel.sql.</Empty> : (
        <>
          <Panel title="Funnel (last 90 days)">
            <FunnelSteps steps={[
              step("Qualifying comments", f.qualifying_comments), step("Messenger interactions", f.messenger_interactions),
              step("Invites sent", f.invites_sent), step("Trials activated", f.trials_activated),
              step("First bid finalized", f.first_bid_finalized), step("First paid upgrade", f.first_paid_upgrade),
            ]} />
          </Panel>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Private replies sent" value={f.private_replies_sent} sub={`${fmt(f.private_replies_failed)} failed or skipped`} />
            <Kpi label="Reminders sent" value={f.reminders_sent} tone="blue" />
            <Kpi label="Opt-outs" value={f.opt_outs} tone="amber" />
            <Kpi label="Invite requests" value={f.invites_requested} sub={Object.entries(f.by_source).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none yet"} tone="blue" />
            <Kpi label="Invite emails failed" value={f.invite_emails_failed} tone="red" />
            <Kpi label="Trials active now" value={f.trials_active_now} />
          </div>
        </>
      )}

      <Panel title="Meta readiness (live check)">
        <Table head={["Check", "Status", "Detail"]} minWidth={560}>
          {ready.checks.map((c) => (
            <tr key={c.key}><td>{c.label}</td><td>{c.ok === null ? <Chip tone="muted">–</Chip> : c.ok ? <Chip tone="green">OK</Chip> : <Chip tone="red">Needs work</Chip>}</td><td className="text-ink-soft">{c.detail}</td></tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">App mode (Development vs Live), App Review and Business Verification aren&apos;t readable through the API: check them in the Meta App Dashboard. In Development mode only people with a role on the app trigger the webhook.</p>
      </Panel>

      <Panel title="Posts: organic test vs paid ad (verified separately)">
        {ready.posts.length === 0 ? <Empty>No post ids configured (META_TEST_POST_IDS / META_AD_POST_IDS).</Empty> : (
          <Table head={["Post", "Type", "Readable by our Page token", "BID comments received", "Private replies sent", "Verified end to end"]} minWidth={760}>
            {ready.posts.map((p) => {
              const s = byPost.get(p.id);
              const verified = (s?.replied ?? 0) > 0;
              return (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.kind === "paid_ad" ? <Chip tone="amber">Paid ad</Chip> : <Chip tone="blue">Organic test</Chip>}</td>
                  <td>{p.readable === null ? "–" : p.readable ? "Yes" : "No"} <span className="text-ink-soft">{p.detail}</span></td>
                  <td>{fmt(s?.comments ?? 0)}</td>
                  <td>{fmt(s?.replied ?? 0)}</td>
                  <td>{verified ? <Chip tone="green">Yes</Chip> : <Chip tone="muted">Not yet</Chip>}</td>
                </tr>
              );
            })}
          </Table>
        )}
        {f && Object.keys(f.reply_formats).length > 0 && <p className="mt-3 text-xs text-muted">Private reply format accepted by Meta: {Object.entries(f.reply_formats).map(([k, v]) => `${k} ${v}`).join(", ")}.</p>}
      </Panel>

      {f && f.last_errors.length > 0 && (
        <Panel title="Recent Meta errors">
          <Table head={["When", "Event", "Error"]} minWidth={560}>
            {f.last_errors.map((e, i) => <tr key={i}><td>{e.at.slice(0, 16).replace("T", " ")}</td><td>{e.kind}</td><td className="text-ink-soft">{e.error}</td></tr>)}
          </Table>
        </Panel>
      )}
    </div>
  );
}
