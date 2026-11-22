import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import type { Lead } from "@/lib/sales/crm";
import type { CampaignState } from "@/components/sales/campaign-panel";
import { answeredInitial, buildCtx, footer, noAnswerInitial, START_BLOCK_LABEL } from "@/lib/sales/nurture/templates";
import { site } from "@/lib/site";
import { startCampaign } from "../../campaign-actions";

export const metadata = { title: "Review email" };
const input = "min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";

/**
 * The first email of a campaign, prefilled from the lead's CRM record and the rep's own details and
 * tracked link. The rep reviews and edits it; sending starts the campaign. The compliance footer is
 * added at send time and can't be edited.
 */
export default async function ComposeEmail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string; err?: string }> }) {
  const { db } = await requireSalesRep();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const kind = sp.kind === "no_answer" ? "no_answer" : "answered";
  const [{ data: ld, error }, campRes] = await Promise.all([db.rpc("sales_crm_lead", { p_id: id }), db.rpc("sales_campaign_lead", { p_lead: id })]);
  if (error || !ld || campRes.error || !campRes.data) notFound();
  const l = (ld as { lead: Lead }).lead;
  const s = campRes.data as CampaignState & { postal_address: string | null };
  const block = s.can_start[kind];
  const ctx = buildCtx({ contactName: l.contact_name, companyName: l.company_name, trades: l.trades, rep: s.rep, origin: site.url });
  const hasAccount = s.milestones.linked || s.milestones.top === "account_exists";
  const draft = kind === "answered" ? answeredInitial(ctx, { hasAccount }) : noAnswerInitial(ctx);
  const foot = footer({ companyName: l.company_name, postalAddress: s.postal_address ?? "(postal address)", unsubscribeUrl: `${site.url}/unsubscribe/sales?t=…`, repFirstName: s.rep.full_name.split(/\s+/)[0] });
  const days = s.follow_up_days;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/sales/leads/${id}`} className="text-sm font-semibold text-brand underline">← {l.company_name}</Link>
        <h1 className="mt-2 text-3xl font-extrabold">{kind === "answered" ? "Email client follow-up" : "Start nurture"}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Review and edit this email, then send it. {kind === "answered" ? "The follow-up campaign" : "The nurture campaign"} then sends at most two more emails (around day {days[0]} and day {days[1]}, on weekdays during business hours), and stops as soon as they reply, book a time, opt out or become a paying customer.
        </p>
      </div>
      {sp.err && <Notice tone="warn">{sp.err}</Notice>}
      {s.send_mode === "test" && <Notice tone="warn" title="Test mode">Only these test addresses can receive emails right now: {s.test_recipients.join(", ") || "none"}.</Notice>}
      {block !== "ok" ? (
        <Notice tone="warn" title="This email can't be sent">{START_BLOCK_LABEL[block] ?? "Not available right now."}</Notice>
      ) : (
        <Card className="p-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">To</dt><dd>{l.contact_name ? `${l.contact_name} · ` : ""}{l.email}</dd>
            <dt className="text-muted">From</dt><dd>{s.rep.full_name} at Built2Bid &lt;{s.rep.from_email}&gt;</dd>
            <dt className="text-muted">Replies go to</dt><dd>{s.rep.from_email}</dd>
            {s.milestones.top !== "none" && <><dt className="text-muted">Account</dt><dd><Badge tone="brand">{hasAccount ? "Already has a Built2Bid account: the email links to sign-in, not sign-up" : ""}</Badge></dd></>}
          </dl>
          {!ctx.firstName && <p className="mt-3 text-xs text-muted">No first name on file, so the greeting says &quot;Hi there&quot;. Add the contact&apos;s name in the lead&apos;s Details to personalize it.</p>}
          {!s.rep.booking_slug && <p className="mt-1 text-xs text-muted">Tip: turn on your booking page in Calendar so follow-ups can include your scheduling link. Until then they ask the lead to reply with a time.</p>}
          <form action={startCampaign} className="mt-4 space-y-3">
            <input type="hidden" name="id" value={id} /><input type="hidden" name="kind" value={kind} />
            <label className="block text-sm font-semibold">Subject<input name="subject" required minLength={3} maxLength={200} defaultValue={draft.subject} className={input} /></label>
            <label className="block text-sm font-semibold">Message<textarea name="body" required minLength={20} maxLength={6000} rows={18} defaultValue={draft.body} className={`${input} py-2 font-normal`} /></label>
            <div className="rounded-lg bg-paper p-3 text-xs text-muted"><p className="font-semibold">Added to every email (can&apos;t be edited):</p><p className="whitespace-pre-wrap">{foot.trim()}</p></div>
            <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" name="confirm" required className="mt-1 h-5 w-5" /> I reviewed this email. Everything in it is accurate (no promises, discounts or claims I can&apos;t back up).</label>
            <div className="flex flex-wrap gap-3">
              <button className="min-h-11 rounded-lg bg-ink px-5 text-sm font-semibold text-white">Send and start {kind === "answered" ? "follow-up" : "nurture"}</button>
              <Link href={`/sales/leads/${id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold">Cancel</Link>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
