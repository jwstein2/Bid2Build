import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { loadSettings } from "@/lib/creator/outreach/runner";
import { outreachEnv } from "@/lib/creator/outreach/send";
import { DEFAULT_FOLLOW_UP_BODY, sendingBlockers } from "@/lib/creator/outreach/templates";
import { Flash, btn, btnSecondary, fmtDate, input } from "@/components/creator/flash";
import { addSlots, removeSlot, saveFollowUpTemplate, saveSettings, setSending } from "../actions";
import { CreatorSubNav } from "../sub-nav";

export const dynamic = "force-dynamic";

export default async function OutreachSettings({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { db } = await requireAdmin();
  const sp = await searchParams;
  const s = await loadSettings(db);
  if (!s) return <p className="text-ink-soft">Outreach tables aren&apos;t installed yet.</p>;
  const env = outreachEnv();
  const blockers = sendingBlockers(s, { enabled: env.enabled, hasKey: Boolean(env.apiKey), hasUnsubscribeSecret: Boolean(env.secret) });
  const { data: slots } = await db.from("creator_cohort_slots").select("id, cohort, trade, gift_tier, reserved_prospect_id, creator_prospects(channel_name)").order("cohort").order("trade");
  type Slot = { id: string; cohort: string; trade: string; gift_tier: number; reserved_prospect_id: string | null; creator_prospects: { channel_name: string } | null };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-extrabold">Creator Partnerships</h1>
      <CreatorSubNav current="/admin/creators/settings" />
      <Flash msg={sp.msg} err={sp.err} />

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Sending workflow</h2>
          {blockers.length === 0 ? <Badge tone="ok">Live: approved emails will send</Badge> : <Badge tone="warn">Off: nothing will be sent</Badge>}
        </div>
        {blockers.length > 0 && <Notice tone="neutral" title="What's stopping sends"><ul className="list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul></Notice>}
        <p className="text-sm text-ink-soft">
          The scheduler runs every 15 minutes. It sends only emails you approved one by one, then ONE follow-up {s.follow_up_hours} hours later if there&apos;s no reply,
          using the follow-up template you approve below. The response deadline is the first Friday 5:00 PM Central at least 48 hours after the follow-up.
          After that, a non-responding creator is marked &quot;No Response — First Cohort&quot;, their slot goes to the next creator in the same trade (into your approval queue), and no further emails are sent.
          Replies, unsubscribes and bounces stop everything for that creator immediately.
        </p>
        {s.sending_enabled ? (
          <form action={setSending}><input type="hidden" name="on" value="false" /><p className="mb-2 text-sm">Approved {fmtDate(s.approved_at, true)}.</p><button className={btnSecondary}>Switch sending off</button></form>
        ) : (
          <form action={setSending} className="space-y-2"><input type="hidden" name="on" value="true" />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /> I approve this outreach workflow, the first batch I&apos;ve approved, and the follow-up template. Sends stay within the daily limit and business hours.</label>
            <button className={btn}>Approve and switch on</button></form>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-display text-lg font-bold">Sender and limits</h2>
        <form action={saveSettings} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm"><span className="mb-1 block font-medium">Verified sender name</span><input name="sender_name" defaultValue={s.sender_name ?? ""} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Verified sender email (on a domain verified with the provider)</span><input name="sender_email" type="email" defaultValue={s.sender_email ?? ""} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Reply-to (the mailbox that receives replies)</span><input name="reply_to" type="email" defaultValue={s.reply_to ?? ""} className={input} /></label>
          <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Postal address (required by CAN-SPAM)</span><input name="postal_address" defaultValue={s.postal_address ?? ""} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Daily send limit</span><input name="daily_send_limit" type="number" min={1} max={100} defaultValue={s.daily_send_limit} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Follow-up after (hours)</span><input name="follow_up_hours" type="number" min={24} max={336} defaultValue={s.follow_up_hours} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Business hours start (Central)</span><input name="business_hour_start" type="number" min={0} max={23} defaultValue={s.business_hour_start} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Business hours end (Central)</span><input name="business_hour_end" type="number" min={1} max={24} defaultValue={s.business_hour_end} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Cohort name</span><input name="cohort_label" defaultValue={s.cohort_label ?? ""} className={input} /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="cohort_deadline_is_real" defaultChecked={s.cohort_deadline_is_real} className="mt-1" /> This cohort has a real enrollment deadline and capacity. (Only then does the follow-up mention finalizing the group this week.)</label>
          <div className="sm:col-span-2"><button className={btnSecondary}>Save settings</button></div>
        </form>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Follow-up template</h2>
          {s.follow_up_approved_at ? <Badge tone="ok">Approved {fmtDate(s.follow_up_approved_at)}</Badge> : <Badge tone="warn">Not approved: no follow-ups will be created</Badge>}
        </div>
        <p className="mt-1 text-sm text-ink-soft">Placeholders: [First Name], [5/10], [original subject], [Sender Name]. Text between [DEADLINE] and [/DEADLINE] is included only when the cohort deadline is marked real. Editing withdraws approval.</p>
        <form action={saveFollowUpTemplate} className="mt-3 space-y-2">
          <input name="follow_up_subject" defaultValue={s.follow_up_subject} className={input} />
          <textarea name="follow_up_body" rows={14} defaultValue={s.follow_up_body ?? DEFAULT_FOLLOW_UP_BODY} className={input} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="approve" className="mt-1" /> Approve this exact follow-up text for automatic use.</label>
          <button className={btnSecondary}>Save template</button>
        </form>
      </Card>

      <Card className="p-4">
        <h2 className="font-display text-lg font-bold">Cohort capacity</h2>
        <p className="mt-1 text-sm text-ink-soft">Each slot is one real partnership opening. A slot is held by one creator at a time; when a creator doesn&apos;t respond by the deadline, their slot moves to the next creator in the same trade.</p>
        <ul className="mt-3 divide-y divide-line text-sm">
          {((slots ?? []) as unknown as Slot[]).map((sl) => (
            <li key={sl.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{sl.cohort} · {sl.trade} · {sl.gift_tier} gifts</span>
              {sl.reserved_prospect_id ? <a href={`/admin/creators/${sl.reserved_prospect_id}`} className="underline">Held by {sl.creator_prospects?.channel_name ?? "creator"}</a>
                : <form action={removeSlot}><input type="hidden" name="slot_id" value={sl.id} /><button className="text-sm text-danger underline">Remove</button></form>}
            </li>
          ))}
          {(slots ?? []).length === 0 && <li className="py-2 text-ink-soft">No slots yet.</li>}
        </ul>
        <form action={addSlots} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm"><span className="mb-1 block font-medium">Cohort</span><input name="cohort" defaultValue={s.cohort_label ?? "First cohort"} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Trade</span><input name="trade" placeholder="e.g. Deck construction & outdoor living" className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Slots</span><input name="count" type="number" min={1} max={20} defaultValue={1} className={input} /></label>
          <label className="text-sm"><span className="mb-1 block font-medium">Gifts</span><select name="gift_tier" className={input}><option value="5">5</option><option value="10">10</option></select></label>
          <button className={btnSecondary}>Add</button>
        </form>
      </Card>
    </div>
  );
}
