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
type BidCheckFunnel = {
  started: number; completed: number; result_shown: number; deep_completed: number; sample_opened: number; free_bid_clicked: number;
  invite_requested: number; pass_activated: number; first_bid_finalized: number; paid_upgrade: number;
  by_goal: Record<string, number>; by_trade: Record<string, number>;
  by_campaign: { campaign: string; started: number; completed: number; invites: number }[];
  recent_feedback: { at: string; trade: string | null; goal: string | null; text: string }[];
};

/**
 * Owner view of the Facebook "comment BID" funnel: live Meta readiness checks and counts. Organic
 * test posts and paid ad posts are verified separately: a passing organic test says nothing about
 * the ad placement.
 */
export default async function FacebookTrialAdmin() {
  const { user, db } = await requireAdmin();
  const cfg = trialConfig();
  const [{ data, error }, ready, bc] = await Promise.all([
    db.rpc("trial_campaign_funnel", { p_caller: user.id }), metaReadiness(cfg), db.rpc("bid_check_funnel", { p_caller: user.id }),
  ]);
  const f = (error ? null : data) as Funnel | null;
  const q = (bc.error ? null : bc.data) as BidCheckFunnel | null;
  const pairs = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet";
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

      <Panel title="Bid check questionnaire (/bid-check, last 90 days)">
        {!q ? <Empty>Questionnaire numbers unavailable: run the migration 20261118003000_bid_check_questionnaire.sql.</Empty> : (
          <div className="space-y-4">
            <FunnelSteps steps={[
              step("Started", q.started), step("Completed", q.completed), step("Result shown", q.result_shown),
              step("Pass requested", q.invite_requested), step("Pass activated", q.pass_activated),
              step("First bid finalized", q.first_bid_finalized), step("Paid upgrade", q.paid_upgrade),
            ]} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Bonus questions done" value={q.deep_completed} tone="blue" />
              <Kpi label="Example opened in builder" value={q.sample_opened} tone="blue" />
              <Kpi label="Free bid clicked" value={q.free_bid_clicked} />
              <Kpi label="Goals" value={Object.values(q.by_goal).reduce((a, b) => a + b, 0)} sub={pairs(q.by_goal)} />
            </div>
            <p className="text-xs text-muted">Trades: {pairs(q.by_trade)}</p>
            {q.by_campaign.length > 0 && (
              <Table head={["Campaign", "Started", "Completed", "Pass requested"]} minWidth={480}>
                {q.by_campaign.map((c) => <tr key={c.campaign}><td>{c.campaign}</td><td>{fmt(c.started)}</td><td>{fmt(c.completed)}</td><td>{fmt(c.invites)}</td></tr>)}
              </Table>
            )}
            {q.recent_feedback.length > 0 && (
              <Table head={["When", "Trade", "Goal", "What they'd change"]} minWidth={560}>
                {q.recent_feedback.map((r, i) => <tr key={i}><td>{r.at.slice(0, 10)}</td><td>{r.trade ?? "–"}</td><td>{r.goal ?? "–"}</td><td className="text-ink-soft">{r.text}</td></tr>)}
              </Table>
            )}
          </div>
        )}
      </Panel>

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
