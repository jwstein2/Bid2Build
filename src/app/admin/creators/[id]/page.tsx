import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { MANUAL_STAGES, STAGE_LABELS, STAGE_TONES, isStage, type Stage } from "@/lib/creator/crm";
import { REPLY_LABELS } from "@/lib/creator/outreach/classify";
import { unresolvedPlaceholders } from "@/lib/creator/outreach/templates";
import { defaultWorkspaceName } from "@/lib/creator/program";
import { Flash, btn, btnSecondary, fmtDate, input } from "@/components/creator/flash";
import { addNote, approveDraft, cancelMessage, logReply, releaseSlot, reserveSlot, saveDraft, setStage, updateContact } from "../actions";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  stage: "Status changed", initial_sent: "Initial email sent", follow_up_scheduled: "Follow-up scheduled", follow_up_sent: "Follow-up sent",
  reply: "Reply received", deadline_set: "Response deadline set", no_response: "No response by deadline", reallocated: "Opportunity reallocated",
  slot_reserved: "Partnership slot reserved", slot_released: "Partnership slot released", suppressed: "Added to do-not-email list",
  bounce: "Bounced", send_failed: "Send failed", note: "Note", draft: "Draft saved", approved: "Owner approved email",
};

export default async function Prospect({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { db } = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ data: p }, { data: messages }, { data: events }, { data: slots }, { data: settings }] = await Promise.all([
    db.from("creator_prospects").select("*").eq("id", id).maybeSingle(),
    db.from("creator_outreach_messages").select("*").eq("prospect_id", id).order("created_at"),
    db.from("creator_outreach_events").select("id, kind, at, details").eq("prospect_id", id).order("at", { ascending: false }).limit(200),
    db.from("creator_cohort_slots").select("id, cohort, trade, gift_tier, reserved_prospect_id").order("cohort"),
    db.from("creator_outreach_settings").select("sending_enabled, approved_at").eq("id", true).maybeSingle(),
  ]);
  if (!p) notFound();
  const initial = (messages ?? []).find((m) => m.kind === "initial" && m.status !== "cancelled");
  const followUp = (messages ?? []).find((m) => m.kind === "follow_up" && m.status !== "cancelled");
  const mySlot = (slots ?? []).find((s) => s.reserved_prospect_id === p.id);
  const openSlots = (slots ?? []).filter((s) => !s.reserved_prospect_id);
  const holes = initial ? unresolvedPlaceholders(`${initial.subject}\n${initial.body_text}`) : [];
  const research = (p.research ?? {}) as Record<string, unknown>;
  const facts: [string, unknown][] = [
    ["Channel", p.channel_url ? <a key="c" href={p.channel_url} className="underline" rel="noreferrer noopener" target="_blank">{p.channel_url}</a> : "—"],
    ["Channel ID", p.channel_id], ["Creator / company", [p.creator_name, p.company].filter(Boolean).join(" · ")], ["Subscribers", p.subscribers_text],
    ["Lifetime views", p.lifetime_views?.toLocaleString("en-US")], ["Recent long-form median views", research.median_views_last10_longform],
    ["Recent Shorts median views", research.median_views_recent_shorts], ["Long-form uploads (90 days)", research.longform_uploads_last_90d],
    ["Relevant videos", research.relevant_videos], ["Educational subjects", research.educational_subjects],
    ["Contractor-audience evidence", research.contractor_audience_evidence], ["Bidding / business evidence", research.bidding_business_evidence],
    ["Personalization angle", p.personalization], ["Score breakdown", p.score_breakdown ? Object.entries(p.score_breakdown as Record<string, number>).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ") : null],
    ["Confidence / gaps", [p.confidence, p.gaps].filter(Boolean).join(" — ")], ["Verified", p.verification_date],
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/admin/creators" className="text-ink-soft underline">Creator Partnerships</Link> <span className="text-muted">/</span></p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">{p.channel_name}</h1>
          <p className="text-ink-soft">{p.trade} · rank {p.rank ?? "—"} · score {p.score ?? "—"}/100 · {p.gift_tier} gifts</p>
        </div>
        {isStage(p.stage as unknown) && <Badge tone={STAGE_TONES[p.stage as Stage]} className="text-sm">{STAGE_LABELS[p.stage as Stage]}</Badge>}
      </div>
      <Flash msg={sp.msg} err={sp.err} />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="font-display text-lg font-bold">Research</h2>
            <dl className="mt-2 grid gap-2 text-sm">
              {facts.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
                <div key={k} className="grid gap-1 sm:grid-cols-[12rem_1fr]"><dt className="font-medium text-ink-soft">{k}</dt><dd className="break-words">{v as React.ReactNode}</dd></div>
              ))}
            </dl>
            {(p.sources as string[]).length > 0 && (
              <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Sources ({(p.sources as string[]).length})</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">{(p.sources as string[]).map((s) => <li key={s} className="break-all"><a href={s} className="underline" target="_blank" rel="noreferrer noopener">{s}</a></li>)}</ul>
              </details>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="font-display text-lg font-bold">Initial outreach email</h2>
            {!settings?.sending_enabled && <p className="mt-1 text-sm text-ink-soft">Sending is off. Approving queues the email; nothing goes out until you approve the workflow in <Link href="/admin/creators/settings" className="underline">Settings</Link>.</p>}
            {initial && initial.status !== "draft" ? (
              <div className="mt-3 space-y-2 text-sm">
                <p><Badge tone={initial.status === "sent" ? "ok" : "accent"}>{initial.status === "sent" ? `Sent ${fmtDate(initial.sent_at, true)}` : initial.status === "approved" ? "Approved, waiting to send" : initial.status}</Badge></p>
                <p><span className="font-medium">To:</span> {initial.to_email}</p>
                <p><span className="font-medium">Subject:</span> {initial.subject}</p>
                <pre className="whitespace-pre-wrap rounded-md bg-paper p-3 font-sans">{initial.body_text}</pre>
                {initial.last_error && <p className="text-xs text-warn">{initial.last_error}</p>}
                {["approved", "failed"].includes(initial.status) && (
                  <form action={cancelMessage}><input type="hidden" name="prospect_id" value={p.id} /><input type="hidden" name="message_id" value={initial.id} /><button className={btnSecondary}>Cancel this email</button></form>
                )}
              </div>
            ) : (
              <>
                <form action={saveDraft} className="mt-3 space-y-2">
                  <input type="hidden" name="prospect_id" value={p.id} />
                  <label className="block text-sm"><span className="mb-1 block font-medium">Subject</span><input name="subject" defaultValue={initial?.subject ?? ""} maxLength={200} className={input} /></label>
                  <label className="block text-sm"><span className="mb-1 block font-medium">Body (the footer with your postal address and unsubscribe link is added automatically)</span>
                    <textarea name="body" defaultValue={initial?.body_text ?? ""} rows={12} maxLength={6000} className={input} /></label>
                  <button className={btnSecondary}>Save draft</button>
                </form>
                {initial && (
                  <form action={approveDraft} className="mt-3 space-y-2 rounded-md border border-line p-3">
                    <input type="hidden" name="prospect_id" value={p.id} />
                    {holes.length > 0 && <Notice tone="warn">Fill in before approving: {holes.join(", ")}</Notice>}
                    {!p.contact_email && <Notice tone="warn">No verified public business email yet. Add one with its source below.</Notice>}
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" /> I approve sending this exact message to {p.contact_email ?? "(no email)"}. It references real content and makes no promises beyond what&apos;s built.</label>
                    <button className={btn} disabled={!p.contact_email || holes.length > 0}>Approve for sending</button>
                  </form>
                )}
              </>
            )}
            {followUp && (
              <div className="mt-4 border-t border-line pt-3 text-sm">
                <p className="font-medium">Follow-up: <Badge tone={followUp.status === "sent" ? "ok" : "accent"}>{followUp.status === "sent" ? `Sent ${fmtDate(followUp.sent_at, true)}` : followUp.status}</Badge></p>
                <pre className="mt-2 whitespace-pre-wrap rounded-md bg-paper p-3 font-sans">{followUp.body_text}</pre>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="font-display text-lg font-bold">Contact verification</h2>
            <p className="mt-1 text-sm text-ink-soft">{p.contact_status ?? "No contact notes."}</p>
            <form action={updateContact} className="mt-3 space-y-2">
              <input type="hidden" name="prospect_id" value={p.id} />
              <label className="block text-sm"><span className="mb-1 block font-medium">Published business email</span><input name="contact_email" type="email" defaultValue={p.contact_email ?? ""} className={input} /></label>
              <label className="block text-sm"><span className="mb-1 block font-medium">Where it&apos;s published (https://)</span><input name="contact_source_url" defaultValue={p.contact_source_url ?? ""} className={input} /></label>
              <label className="block text-sm"><span className="mb-1 block font-medium">Gift allowance offered</span>
                <select name="gift_tier" defaultValue={String(p.gift_tier)} className={input}><option value="5">5 gifts</option><option value="10">10 gifts</option></select></label>
              <p className="text-xs text-muted">Only use emails the creator published themselves. Never use gated reveals or guessed addresses.</p>
              <button className={btnSecondary}>Save contact</button>
            </form>
          </Card>

          <Card className="p-4">
            <h2 className="font-display text-lg font-bold">Timeline</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-ink-soft">Initial sent</dt><dd>{fmtDate(p.initial_sent_at, true)}</dd>
              <dt className="text-ink-soft">Follow-up due</dt><dd>{fmtDate(p.follow_up_due_at, true)}</dd>
              <dt className="text-ink-soft">Follow-up sent</dt><dd>{fmtDate(p.follow_up_sent_at, true)}</dd>
              <dt className="text-ink-soft">Response deadline</dt><dd>{fmtDate(p.response_deadline_at, true)}</dd>
              <dt className="text-ink-soft">Replied</dt><dd>{fmtDate(p.replied_at, true)}{p.reply_classification ? ` (${REPLY_LABELS[p.reply_classification as keyof typeof REPLY_LABELS] ?? p.reply_classification})` : ""}</dd>
              <dt className="text-ink-soft">Cohort slot</dt><dd>{mySlot ? `${mySlot.cohort} · ${mySlot.trade}` : "None"}</dd>
            </dl>
            <ol className="mt-4 space-y-2 border-l border-line pl-4 text-sm">
              {(events ?? []).map((e) => (
                <li key={e.id}><p className="font-medium">{EVENT_LABELS[e.kind] ?? e.kind} <span className="font-normal text-muted">· {fmtDate(e.at, true)}</span></p>
                  {e.details && Object.keys(e.details).length > 0 && <p className="break-words text-xs text-ink-soft">{Object.entries(e.details as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 600)}</p>}</li>
              ))}
              {(events ?? []).length === 0 && <li className="text-ink-soft">Nothing yet.</li>}
            </ol>
          </Card>

          <Card className="space-y-4 p-4">
            <h2 className="font-display text-lg font-bold">Actions</h2>
            <form action={logReply} className="space-y-2">
              <input type="hidden" name="prospect_id" value={p.id} />
              <p className="text-sm font-medium">Log a reply</p>
              <textarea name="text" rows={3} maxLength={5000} placeholder="Paste the reply text" className={input} />
              <select name="classification" className={input} defaultValue=""><option value="">Classify automatically</option>{Object.entries(REPLY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className={btnSecondary}>Log reply (cancels follow-ups)</button>
            </form>
            <form action={setStage} className="space-y-2">
              <input type="hidden" name="prospect_id" value={p.id} />
              <p className="text-sm font-medium">Set status</p>
              <select name="stage" className={input} defaultValue={MANUAL_STAGES.includes(p.stage) ? p.stage : ""}><option value="" disabled>Choose</option>{MANUAL_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
              <input name="evidence" maxLength={1000} placeholder="For Accepted: how the creator explicitly accepted the terms" className={input} />
              <button className={btnSecondary}>Update status</button>
            </form>
            <div className="space-y-2">
              <p className="text-sm font-medium">Partnership slot</p>
              {mySlot ? (
                <form action={releaseSlot}><input type="hidden" name="prospect_id" value={p.id} /><button className={btnSecondary}>Release {mySlot.cohort} slot</button></form>
              ) : openSlots.length ? (
                <form action={reserveSlot} className="flex gap-2"><input type="hidden" name="prospect_id" value={p.id} />
                  <select name="slot_id" className={input}>{openSlots.map((s) => <option key={s.id} value={s.id}>{s.cohort} · {s.trade} · {s.gift_tier} gifts</option>)}</select>
                  <button className={btnSecondary}>Reserve</button></form>
              ) : <p className="text-sm text-ink-soft">No open slots. Add cohort capacity in <Link href="/admin/creators/settings" className="underline">Settings</Link>.</p>}
            </div>
            {p.stage === "accepted" && (
              p.program_id
                ? <Link href={`/admin/creators/programs/${p.program_id}`} className="inline-block text-sm font-semibold text-accent-ink underline">Open Learning Enterprise program</Link>
                : <Link href={`/admin/creators/programs?prospect=${p.id}&email=${encodeURIComponent(p.contact_email ?? "")}&workspace=${encodeURIComponent(defaultWorkspaceName(p.channel_name.replace(/\s*\(.*\)$/, "")))}&gifts=${p.gift_tier}&channel=${encodeURIComponent(p.channel_name)}&url=${encodeURIComponent(p.channel_url ?? "")}`} className="inline-block text-sm font-semibold text-accent-ink underline">Create Learning Enterprise program</Link>
            )}
            <form action={addNote} className="space-y-2"><input type="hidden" name="prospect_id" value={p.id} />
              <textarea name="note" rows={2} maxLength={2000} placeholder="Add a note" className={input} /><button className={btnSecondary}>Add note</button></form>
          </Card>
        </div>
      </div>
    </div>
  );
}
