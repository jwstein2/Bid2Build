import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { dateLabel, usd } from "@/lib/sales/format";
import { AWARD_STATUS, REWARD_CATEGORIES, SUCCESS_TEXT, TAX_LABELS } from "@/lib/sales/preferences";
import {
  markSuccessCongratulated, proposeAward, saveDigestSettings, saveCongratsSettings, saveRecognitionNote, saveReward, sendCongratsEmail, setAward, skipCongratsEmail,
} from "./recognition-actions";

export interface Recognition {
  settings: { congrats_enabled: boolean; congrats_subject: string; congrats_body: string };
  successes: { id: string; rep_id: string; rep: string; kind: string; occurred_at: string; customer: string; customer_id: string; congratulated_at: string | null; admin_note: string | null; award: string | null }[];
  congrats: { id: string; rep: string; rep_id: string; subject: string; body: string; status: string; attempts: number; last_error: string | null; sent_at: string | null; created_at: string; customer: string }[];
  rewards: { id: string; name: string; description: string | null; category: string; eligibility: string | null; value_cents: number; cost_cents: number; redemption_method: string | null; tax_treatment: string; status: string }[];
  awards: { id: string; rep_id: string; rep: string; reward: string | null; reason: string; value_cents: number; tax_category: string; status: string; proposed_at: string; authorized_at: string | null; delivered_at: string | null; commission_status: string | null; note: string | null }[];
  preferences: { rep_id: string; rep: string; status: string; public_recognition: boolean; congrats_email: boolean; recognition: Record<string, string | string[]>; interests: Record<string, string> | null }[];
}

const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";
const btn = "min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white";
const btnLight = "min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold";
const show = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : v ?? "").replace(/_/g, " ");

export type DigestPreview = { enabled: boolean; sales: number; successes: unknown[]; achievements: unknown[]; awaiting: { congrats: number; rewards: number; boxes: number; not_congratulated: number } };

export function RecognitionPanel({ r, isOwner, canPropose, digest }: { r: Recognition; isOwner: boolean; canPropose: boolean; digest?: DigestPreview | null }) {
  const pending = r.congrats.filter((m) => m.status === "draft" || m.status === "failed" || m.status === "sending");
  const activeRewards = r.rewards.filter((w) => w.status === "active");
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Owner congratulations</h2>
          <Badge tone={r.settings.congrats_enabled ? "ok" : "neutral"}>{r.settings.congrats_enabled ? "On: each email waits for approval" : "Off"}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted">When a rep&apos;s customer completes onboarding, a draft appears here. Nothing is sent until the owner reviews and sends it, from the verified founder address. Reps who turn these off never get one.</p>
        {pending.length === 0 ? <p className="mt-3 text-sm text-ink-soft">No emails waiting.</p> : (
          <div className="mt-3 space-y-4">
            {pending.map((m) => (
              <div key={m.id} className="rounded-lg border border-line p-3">
                <p className="text-sm font-semibold">{m.rep} · {m.customer} completed onboarding <span className="font-normal text-muted">({dateLabel(m.created_at)})</span></p>
                {m.status === "failed" && <p className="text-xs text-danger">Last try failed: {m.last_error}</p>}
                {isOwner ? (
                  <div className="mt-2 grid gap-2">
                    <form action={sendCongratsEmail} className="grid gap-2">
                      <input type="hidden" name="id" value={m.id} />
                      <label className="text-xs">Subject<input name="subject" defaultValue={m.subject} maxLength={200} className={input} /></label>
                      <label className="text-xs">Message<textarea name="body" defaultValue={m.body} maxLength={5000} rows={8} className={`${input} py-2`} /></label>
                      <div><button className={btn}>Send from the founder address</button></div>
                    </form>
                    <form action={skipCongratsEmail}><input type="hidden" name="id" value={m.id} /><button className="text-sm font-semibold text-ink-soft underline">Skip this one</button></form>
                  </div>
                ) : <p className="mt-1 text-xs text-muted">Waiting for the owner.</p>}
              </div>
            ))}
          </div>
        )}
        {isOwner && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">Settings and default message</summary>
            <form action={saveCongratsSettings} className="mt-3 grid gap-2">
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={r.settings.congrats_enabled} className="mt-1" /> Create a congratulations draft when a rep&apos;s customer completes onboarding</label>
              <label className="text-xs">Subject<input name="subject" defaultValue={r.settings.congrats_subject} maxLength={200} className={input} /></label>
              <label className="text-xs">Message (<code>{"{first_name}"}</code> becomes the rep&apos;s first name)<textarea name="body" defaultValue={r.settings.congrats_body} maxLength={5000} rows={10} className={`${input} py-2`} /></label>
              <div><button className={btn}>Save</button></div>
            </form>
          </details>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="p-4 pb-0 text-lg font-bold">Customer successes</h2>
        <p className="px-4 text-xs text-muted">From what customers actually did: an estimate with 3+ priced items, a proposal sent or exported, the 7-day activation goal. Onboarding is complete with both an estimate and a proposal.</p>
        <table className="mt-2 w-full min-w-[860px] text-sm">
          <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">When</th><th className="p-3">Rep</th><th className="p-3">Customer</th><th className="p-3">What</th><th className="p-3">Congratulated</th><th className="p-3">Private note</th></tr></thead>
          <tbody>
            {r.successes.slice(0, 40).map((s) => (
              <tr key={s.id} className="border-b border-line align-top last:border-0">
                <td className="p-3">{dateLabel(s.occurred_at)}</td>
                <td className="p-3"><Link href={`/sales/admin/reps/${s.rep_id}`} className="font-semibold text-brand underline">{s.rep}</Link></td>
                <td className="p-3">{s.customer}</td>
                <td className="p-3">{SUCCESS_TEXT[s.kind]?.title ?? s.kind}{s.award && <p className="text-xs text-muted">Reward {AWARD_STATUS[s.award]?.toLowerCase()}</p>}</td>
                <td className="p-3">{s.congratulated_at ? dateLabel(s.congratulated_at) : <form action={markSuccessCongratulated}><input type="hidden" name="id" value={s.id} /><button className={btnLight}>Mark congratulated</button></form>}</td>
                <td className="p-3">
                  <form action={saveRecognitionNote} className="flex gap-2"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="kind" value="success" />
                    <input name="note" defaultValue={s.admin_note ?? ""} maxLength={1000} aria-label={`Private note for ${s.rep}, ${s.customer}`} className={input} /><button className={btnLight}>Save</button></form>
                </td>
              </tr>
            ))}
            {r.successes.length === 0 && <tr><td colSpan={6} className="p-4 text-ink-soft">No customer successes yet. They&apos;re checked every night.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="p-4 pb-0 text-lg font-bold">Rewards granted</h2>
        <p className="px-4 text-xs text-muted">Sales Administrators propose; the owner authorizes and records delivery. Cash rewards become an earned line on the next statement. Gift cards and prizes are bought and sent by hand, then marked delivered.</p>
        <table className="mt-2 w-full min-w-[860px] text-sm">
          <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Proposed</th><th className="p-3">Rep</th><th className="p-3">Reward</th><th className="p-3">Value</th><th className="p-3">Tax</th><th className="p-3">Status</th></tr></thead>
          <tbody>
            {r.awards.map((a) => (
              <tr key={a.id} className="border-b border-line align-top last:border-0">
                <td className="p-3">{dateLabel(a.proposed_at)}</td><td className="p-3">{a.rep}</td>
                <td className="p-3">{a.reward ?? "Reward"}<p className="text-xs text-muted">{a.reason}</p>{a.note && <p className="text-xs text-muted">Note: {a.note}</p>}</td>
                <td className="p-3">{usd(a.value_cents)}</td><td className="p-3 text-xs">{TAX_LABELS[a.tax_category] ?? a.tax_category}</td>
                <td className="p-3">
                  <Badge tone={a.status === "delivered" ? "ok" : a.status === "canceled" ? "danger" : a.status === "proposed" ? "warn" : "brand"}>{AWARD_STATUS[a.status]}</Badge>
                  {a.commission_status && <p className="text-xs text-muted">Ledger line: {a.commission_status}</p>}
                  {isOwner && !["delivered", "canceled"].includes(a.status) && (
                    <form action={setAward} className="mt-2 flex flex-wrap gap-1">
                      <input type="hidden" name="id" value={a.id} />
                      {a.status === "proposed" && <button name="status" value="authorized" className={btnLight}>Authorize</button>}
                      {a.status === "authorized" && a.tax_category !== "taxable_cash" && <button name="status" value="ordered" className={btnLight}>Ordered</button>}
                      {(a.status === "authorized" || a.status === "ordered") && a.tax_category !== "taxable_cash" && <button name="status" value="delivered" className={btnLight}>Delivered</button>}
                      <button name="status" value="canceled" className={btnLight}>Cancel</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {r.awards.length === 0 && <tr><td colSpan={6} className="p-4 text-ink-soft">No rewards yet.</td></tr>}
          </tbody>
        </table>
        {canPropose && (
          <form action={proposeAward} className="grid gap-2 border-t border-line p-4 sm:grid-cols-4">
            <label className="text-xs">Rep<select name="rep_id" required className={input}>{r.preferences.map((p) => <option key={p.rep_id} value={p.rep_id}>{p.rep}</option>)}</select></label>
            <label className="text-xs">Reward<select name="reward_id" required className={input}>{activeRewards.map((w) => <option key={w.id} value={w.id}>{w.name} ({usd(w.value_cents)})</option>)}</select></label>
            <label className="text-xs sm:col-span-2">Reason<input name="reason" required maxLength={300} placeholder="e.g. First customer through onboarding" className={input} /></label>
            <div className="sm:col-span-4"><button className={btn} disabled={activeRewards.length === 0}>Propose reward</button>{activeRewards.length === 0 && <span className="ml-2 text-xs text-muted">Publish a reward in the catalog first.</span>}</div>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-bold">Reward catalog</h2>
        <p className="text-xs text-muted">Active rewards are visible to reps. Nothing is bought automatically. Confirm tax treatment with your accountant; cash and gift cards are taxable.</p>
        <ul className="mt-3 divide-y divide-line text-sm">
          {r.rewards.map((w) => (
            <li key={w.id} className="py-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap justify-between gap-2"><span className="font-semibold">{w.name} · {usd(w.value_cents)} <span className="font-normal text-muted">({REWARD_CATEGORIES[w.category]}, costs {usd(w.cost_cents)})</span></span><Badge tone={w.status === "active" ? "ok" : "neutral"}>{w.status}</Badge></summary>
                {isOwner ? <RewardForm w={w} /> : <p className="mt-2 text-ink-soft">{w.description}</p>}
              </details>
            </li>
          ))}
          {r.rewards.length === 0 && <li className="py-2 text-ink-soft">No rewards yet.</li>}
        </ul>
        {isOwner && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Add a reward</summary><RewardForm /></details>}
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="p-4 pb-0 text-lg font-bold">How each rep likes to be recognized</h2>
        <p className="px-4 text-xs text-muted">Only recognition and reward preferences, plus hobbies when the rep chose to share them. Other answers stay private to the rep and are never used for pay or decisions.</p>
        <table className="mt-2 w-full min-w-[820px] text-sm">
          <thead className="border-b border-line text-left text-muted"><tr><th className="p-3">Rep</th><th className="p-3">Recognition</th><th className="p-3">Rewards</th><th className="p-3">Interests</th><th className="p-3">Public</th></tr></thead>
          <tbody>
            {r.preferences.map((p) => (
              <tr key={p.rep_id} className="border-b border-line align-top last:border-0">
                <td className="p-3 font-semibold">{p.rep}{p.status === "not_started" || p.status === "skipped" ? <p className="text-xs font-normal text-muted">No preferences shared</p> : null}</td>
                <td className="p-3">{[show(p.recognition.celebrate), show(p.recognition.visibility), p.recognition.owner_congrats && `owner: ${show(p.recognition.owner_congrats)}`].filter(Boolean).join(" · ") || "—"}{!p.congrats_email && <p className="text-xs text-muted">No congratulation emails</p>}</td>
                <td className="p-3">{[show(p.recognition.rewards), show(p.recognition.reward_type), show(p.recognition.gift_category)].filter(Boolean).join(" · ") || "—"}</td>
                <td className="p-3">{p.interests ? [p.interests.hobbies, p.interests.experiences].filter(Boolean).join(" · ") || "—" : <span className="text-muted">Not shared</span>}</td>
                <td className="p-3">{p.public_recognition ? "Yes" : "Private"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {digest && (
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-bold">Weekly recognition digest</h2><Badge tone={digest.enabled ? "ok" : "neutral"}>{digest.enabled ? "On" : "Off"}</Badge></div>
          <p className="mt-1 text-sm text-ink-soft">This week so far: {digest.sales} new paying customer{digest.sales === 1 ? "" : "s"}, {digest.successes.length} onboarding{digest.successes.length === 1 ? "" : "s"}, {digest.achievements.length} achievement{digest.achievements.length === 1 ? "" : "s"}. Waiting: {digest.awaiting.congrats} emails, {digest.awaiting.rewards} rewards, {digest.awaiting.boxes} boxes.</p>
          {isOwner && <form action={saveDigestSettings} className="mt-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={digest.enabled} /> Email me this summary every Monday</label><button className={btnLight}>Save</button></form>}
        </Card>
      )}
      {!isOwner && <Notice>Rewards, congratulation emails and their settings are managed by the platform owner.</Notice>}
    </div>
  );
}

function RewardForm({ w }: { w?: Recognition["rewards"][number] }) {
  return (
    <form action={saveReward} className="mt-3 grid gap-2 sm:grid-cols-2">
      {w && <input type="hidden" name="id" value={w.id} />}
      <label className="text-xs">Name<input name="name" required maxLength={120} defaultValue={w?.name} className={input} /></label>
      <label className="text-xs">Category<select name="category" defaultValue={w?.category ?? "gift_card"} className={input}>{Object.entries(REWARD_CATEGORIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-xs">Value to the rep ($)<input name="value" type="number" min={0} max={10000} step="0.01" required defaultValue={w ? w.value_cents / 100 : ""} className={input} /></label>
      <label className="text-xs">Cost to Built2Bid ($)<input name="cost" type="number" min={0} max={10000} step="0.01" defaultValue={w ? w.cost_cents / 100 : ""} className={input} /></label>
      <label className="text-xs sm:col-span-2">Description<input name="description" maxLength={1000} defaultValue={w?.description ?? ""} className={input} /></label>
      <label className="text-xs">Eligibility<input name="eligibility" maxLength={500} defaultValue={w?.eligibility ?? ""} placeholder="e.g. first customer through onboarding" className={input} /></label>
      <label className="text-xs">How it&apos;s delivered<input name="redemption" maxLength={200} defaultValue={w?.redemption_method ?? ""} placeholder="e.g. owner emails an e-gift code" className={input} /></label>
      <label className="text-xs">Tax treatment (cash and gift cards are set automatically)<select name="tax" defaultValue={w?.tax_treatment ?? "taxable_noncash"} className={input}>{Object.entries(TAX_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-xs">Status<select name="status" defaultValue={w?.status ?? "draft"} className={input}><option value="draft">Draft (hidden)</option><option value="active">Active (reps see it)</option><option value="paused">Paused</option><option value="retired">Retired</option></select></label>
      <div className="sm:col-span-2"><button className={btn}>{w ? "Save reward" : "Add reward"}</button></div>
    </form>
  );
}
