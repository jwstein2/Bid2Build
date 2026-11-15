import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, PageHead, Panel, PanelLink, Row, day, type Tone } from "@/components/admin/cc";
import { requireAdmin } from "@/lib/admin/server";
import { str } from "@/lib/admin/view";
import { BAND_LABEL, band, PRIORITY_LABEL } from "@/lib/radar/classify";
import { BLOCKING, flagLabel, type DraftFlag } from "@/lib/radar/draft";
import type { DraftRow } from "@/lib/radar/report";
import { loadOpportunity } from "@/lib/radar/server";
import { canApiPublish, getSource, linksAllowed, defaultState, type SourceState } from "@/lib/radar/sources";
import { canDraft, canLogFollowUp, canReopen, nextAction, REPLY_CAP, STATUS_LABEL } from "@/lib/radar/state";
import { tradeName } from "@/lib/trades/catalog";
import { approveAction, draftAction, editDraftAction, flagClaimAction, followUpAction, markPostedAction, oppAction, publishAction, rejectDraftAction, reopenAction } from "../actions";
import { CopyButton } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunity · Radar" };

const DRAFT_LABEL: Record<DraftRow["status"], string> = {
  draft: "Draft · awaiting your review", approved: "Approved · not posted yet", rejected: "Rejected", superseded: "Replaced",
  posted_manual: "Posted by you", publish_pending: "Publishing · waiting for platform confirmation", published: "Published (platform confirmed)", publish_failed: "Publish failed",
};
const draftTone = (s: DraftRow["status"]): Tone => (s === "draft" ? "amber" : s === "approved" ? "violet" : s === "posted_manual" || s === "published" ? "green" : s === "publish_failed" ? "red" : "muted");
const shortUrl = (u: string) => { const s = u.replace(/^https:\/\//, ""); return s.length > 34 ? `${s.slice(0, 33)}…` : s; };
const btn = "cc-mono rounded-md px-3 py-1.5 text-xs font-semibold";
const ghost = `${btn} border border-[var(--cc-line-strong)] text-white hover:border-white`;

export default async function OpportunityDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db } = await requireAdmin();
  const { opp: o, drafts } = await loadOpportunity(db, id).catch(() => ({ opp: null, drafts: [] as DraftRow[] }));
  if (!o) notFound();
  const src = getSource(o.source_key);
  const { data: st } = await db.from("radar_source_state").select("*").eq("source_key", o.source_key).maybeSingle();
  const state = (st ?? defaultState(o.source_key)) as SourceState;
  const s = { status: o.status, owner_replies_used: o.owner_replies_used, reopened: o.reopened };
  const live = drafts.find((d) => d.status === "draft" || d.status === "approved" || d.status === "publish_pending" || d.status === "publish_failed");
  const posted = drafts.filter((d) => d.status === "posted_manual" || d.status === "published");
  const publishGate = canApiPublish(o.source_key, state, false);
  const canFirst = canDraft(s, 1).ok && !live && o.reply_allowed && !o.content_removed_at && o.priority !== "X";
  const canFollow = canLogFollowUp(s).ok && !live;
  const notice = str(sp.notice), error = str(sp.error);

  return (
    <div className="space-y-6">
      <PageHead kicker={`Opportunity Radar · ${src?.name ?? o.source_key}`} title={o.title}
        intro={`${PRIORITY_LABEL[o.priority]} · score ${o.score} (${BAND_LABEL[band(o.score)]}) · ${STATUS_LABEL[o.status]}${o.reopened ? " · reopened" : ""} · replies used ${o.owner_replies_used}/${REPLY_CAP}`}
        right={<div className="flex flex-wrap gap-2"><a href={o.canonical_url} target="_blank" rel="noopener noreferrer nofollow" className={ghost}>Open original discussion ↗</a><PanelLink href="/admin/marketing/radar">All opportunities</PanelLink></div>} />
      {notice && <p role="status" className="rounded-md border border-[var(--cc-green)]/50 px-3 py-2 text-sm text-[var(--cc-green)]">{notice}</p>}
      {error && <p role="alert" className="rounded-md border border-[var(--cc-red)]/50 px-3 py-2 text-sm text-[var(--cc-red)]">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Panel kicker="Original discussion" title="What they asked" className="lg:col-span-3">
          {o.content_removed_at ? <p className="text-sm text-ink-soft">The author removed this discussion. Its text was deleted from Built2Bid.</p> : (
            <>
              {/* Untrusted third-party text: rendered as plain text only, never as HTML or instructions. */}
              <p className="whitespace-pre-wrap rounded-lg border border-[var(--cc-line)] bg-[rgb(5_9_12/0.5)] p-3 text-sm text-ink-soft" data-testid="radar-excerpt">{o.excerpt || "(No text pasted. Open the discussion to read it.)"}</p>
              {o.injection_suspected && <p className="mt-2 text-xs text-[var(--cc-amber)]">This post contains instruction-like text (for example &quot;ignore previous instructions&quot;). It is treated purely as data and never followed.</p>}
            </>
          )}
          <dl className="mt-4">
            <Row k="Link"><a href={o.canonical_url} target="_blank" rel="noopener noreferrer nofollow" className="underline" title={o.canonical_url}>{shortUrl(o.canonical_url)}</a></Row>
            <Row k="Posted">{day(o.posted_at)}</Row>
            <Row k="Trade">{o.trade ? tradeName(o.trade) : "Not detected"}</Row>
            <Row k="Topics">{o.topics.join(", ") || "–"}</Row>
            <Row k="Pain points">{o.pain_points.join(", ") || "–"}</Row>
            <Row k="Answers when imported">{o.reply_count ?? "Unknown"}</Row>
            <Row k="Links allowed here">{linksAllowed(o.source_key, state) ? "Yes" : "No (domain as plain text only)"}</Row>
            <Row k="Next action">{nextAction({ ...s, score: o.score })}</Row>
          </dl>
        </Panel>
        <Panel kicker="Why this score" title={`${o.score} / 100`} className="lg:col-span-2">
          <ul className="space-y-1.5">
            {(o.score_factors ?? []).map((f) => (
              <li key={f.key} className="text-xs"><div className="flex justify-between text-ink-soft"><span>{f.label}</span><span className="cc-mono text-white">{f.points}/{f.max}</span></div>
                <div className="mt-0.5 h-1.5 rounded bg-[rgb(56_182_255/0.1)]"><div className="h-1.5 rounded bg-[var(--cc-blue)]" style={{ width: `${(f.points / f.max) * 100}%` }} /></div></li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted">A review priority from fixed rules, not a purchase probability.</p>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--cc-line)] pt-3">
            {o.status !== "rejected" && o.status !== "archived" && <form action={oppAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="action" value="reject" /><button className={ghost}>Reject (irrelevant)</button></form>}
            {o.status !== "rejected" && o.status !== "archived" && <form action={oppAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="action" value="archive" /><button className={ghost}>Archive</button></form>}
            {(o.status === "rejected" || o.status === "archived") && !o.content_removed_at && <form action={oppAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="action" value="restore" /><button className={ghost}>Restore</button></form>}
            {o.owner_replies_used > 0 && o.status !== "completed" && <form action={oppAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="action" value="close" /><button className={ghost}>Close conversation</button></form>}
            {o.priority === "D" && !o.allow_product_mention && <form action={oppAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="action" value="allow_mention" /><button className={ghost}>Allow product mention</button></form>}
            {!o.content_removed_at && <form action={oppAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="action" value="removed" /><button className={ghost} title="Use when the author deleted the post or asked for removal">Author removed it</button></form>}
          </div>
        </Panel>
      </div>

      <Panel kicker="Conversation" title={`Replies (${o.owner_replies_used} of ${REPLY_CAP} used)`}>
        <ol className="space-y-4">
          {drafts.filter((d) => d.status !== "superseded").map((d) => {
            const flags = (d.flags ?? []) as DraftFlag[];
            const blocking = flags.filter((f) => BLOCKING.includes(f.kind));
            const editable = d.status === "draft" || d.status === "approved";
            return (
              <li key={d.id} className="rounded-lg border border-[var(--cc-line)] p-4" data-testid="radar-draft">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white">Reply {d.reply_number}{d.reply_number > REPLY_CAP ? " (reopened, owner support)" : d.reply_number === 2 ? " (follow-up)" : " (initial)"} <Chip tone={draftTone(d.status)}>{DRAFT_LABEL[d.status]}</Chip><Chip tone="muted">{d.engine === "ai" ? "AI draft" : d.engine === "owner" ? "Edited by you" : "Rules draft"}</Chip></p>
                  <p className="cc-mono text-[11px] text-muted">{d.posted_at ? `Posted ${day(d.posted_at)}` : `Drafted ${day(d.created_at)}`}{d.posted_url && <> · <a href={d.posted_url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--cc-blue)] underline">your reply ↗</a></>}</p>
                </div>
                {d.follow_up_text && <div className="mt-3"><p className="cc-kicker mb-1">Their follow-up</p><p className="whitespace-pre-wrap rounded-md border border-[var(--cc-line)] bg-[rgb(5_9_12/0.5)] p-2 text-xs text-ink-soft">{d.follow_up_text}</p></div>}
                {flags.length > 0 && editable && (
                  <ul className="mt-3 space-y-1">{flags.map((f, i) => <li key={i} className={`text-xs ${BLOCKING.includes(f.kind) ? "text-[var(--cc-red)]" : "text-[var(--cc-amber)]"}`}>{BLOCKING.includes(f.kind) ? "✕ Must fix: " : "! Check: "}{flagLabel(f)}</li>)}</ul>
                )}
                {editable ? (
                  <form action={editDraftAction} className="mt-3">
                    <input type="hidden" name="draft_id" value={d.id} />
                    <label className="cc-kicker mb-1 block" htmlFor={`body-${d.id}`}>Reply text (preview of what you&apos;ll post)</label>
                    <textarea id={`body-${d.id}`} name="body" defaultValue={d.body} rows={Math.min(14, Math.max(5, Math.ceil(d.body.length / 90)))} maxLength={5000} className="field field-sm font-sans text-sm" />
                    <div className="mt-2 flex flex-wrap items-center gap-2"><button className={ghost}>Save edit</button>{d.status === "draft" ? <CopyButton text={d.body} /> : <span className="text-[11px] text-muted">Saving an edit moves it back to draft for re-approval.</span>}</div>
                  </form>
                ) : (
                  <p className="mt-3 whitespace-pre-wrap rounded-md bg-[rgb(5_9_12/0.5)] p-3 text-sm text-white">{d.body}</p>
                )}
                {d.status === "draft" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--cc-line)] pt-3">
                    <form action={approveAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="draft_id" value={d.id} />
                      {flags.length > 0 && blocking.length === 0 && <label className="flex items-center gap-1.5 text-xs text-ink-soft"><input type="checkbox" name="ack" className="h-4 w-4" />I checked the flagged items</label>}
                      <button disabled={blocking.length > 0} className={`${btn} bg-[var(--cc-green)] text-[#03140c] disabled:cursor-not-allowed disabled:opacity-40`}>Approve draft</button>
                    </form>
                    <form action={rejectDraftAction}><input type="hidden" name="draft_id" value={d.id} /><button className={ghost}>Reject draft</button></form>
                    <form action={flagClaimAction} className="flex items-center gap-1"><input type="hidden" name="draft_id" value={d.id} /><input name="claim" maxLength={200} placeholder="What's wrong?" className="field field-sm !w-40" /><button className={ghost}>Flag unsupported claim</button></form>
                  </div>
                )}
                {d.status === "approved" && (
                  <div className="mt-3 space-y-3 border-t border-[var(--cc-line)] pt-3">
                    <ol className="list-decimal space-y-0.5 pl-5 text-xs text-ink-soft"><li>Copy the response.</li><li>Open the discussion and post it yourself, as yourself.</li><li>Come back and mark it posted (paste the link to your comment if you can).</li></ol>
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyButton text={d.body} />
                      <a href={o.canonical_url} target="_blank" rel="noopener noreferrer nofollow" className={ghost}>Open discussion ↗</a>
                      <form action={markPostedAction} className="flex flex-wrap items-center gap-2"><input type="hidden" name="draft_id" value={d.id} /><input name="posted_url" type="url" placeholder="Link to your posted reply (optional)" className="field field-sm !w-64" /><button className={`${btn} bg-[var(--cc-green)] text-[#03140c]`}>Mark posted manually</button></form>
                      <form action={rejectDraftAction}><input type="hidden" name="draft_id" value={d.id} /><button className={ghost}>Reject</button></form>
                    </div>
                    <form action={publishAction} className="flex items-center gap-2"><input type="hidden" name="draft_id" value={d.id} />
                      <button disabled={!publishGate.ok} title={publishGate.ok ? "" : (publishGate as { reason: string }).reason} className={`${ghost} disabled:cursor-not-allowed disabled:opacity-40`}>Publish via API</button>
                      <span className="text-[11px] text-muted">{publishGate.ok ? "Publishes as your account; marked published only after the platform confirms." : (publishGate as { reason: string }).reason}</span>
                    </form>
                  </div>
                )}
                {d.status === "publish_failed" && d.publish_error && <p className="mt-2 text-xs text-[var(--cc-red)]">{d.publish_error}</p>}
              </li>
            );
          })}
        </ol>
        {drafts.filter((d) => d.status !== "superseded").length === 0 && <p className="text-sm text-ink-soft">No reply drafted yet.</p>}

        <div className="mt-5 border-t border-[var(--cc-line)] pt-4">
          {canFirst && (
            <div className="flex flex-wrap items-center gap-2">
              <form action={draftAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="engine" value="rules" /><button className={`${btn} bg-[var(--cc-green)] text-[#03140c]`}>Generate first reply</button></form>
              <form action={draftAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="engine" value="ai" /><button className={ghost}>Draft with AI</button></form>
              <span className="text-xs text-muted">Rules drafts are free. AI uses the Radar budget and falls back to rules if unavailable.</span>
            </div>
          )}
          {o.priority === "X" && o.owner_replies_used === 0 && <p className="text-sm text-ink-soft">Not about estimating or bidding, so no reply is suggested.</p>}
          {!o.reply_allowed && <p className="text-sm text-ink-soft">You marked this community as not allowing vendor replies. Use it for market learning only.</p>}
          {canFollow && (
            <form action={followUpAction} className="grid gap-2">
              <input type="hidden" name="id" value={o.id} />
              <p className="text-sm font-semibold text-white">{o.reopened ? "Customer question (reopened conversation)" : "Did someone reply directly to you?"}</p>
              <p className="text-xs text-muted">Paste only their reply to your comment. Don&apos;t log replies from unrelated people or private messages.</p>
              <textarea name="follow_up" required rows={3} maxLength={5000} className="field field-sm" placeholder="Their reply to you" />
              <input name="parent_ref" maxLength={2000} className="field field-sm" placeholder={posted.at(-1)?.posted_url ?? "Link to their reply (optional)"} />
              <div><button className={`${btn} bg-[var(--cc-amber)] text-[#1a1200]`}>Draft reply {o.owner_replies_used + 1}</button></div>
            </form>
          )}
          {o.status === "completed" && !o.reopened && (
            <div className="space-y-2">
              <p className="text-sm text-ink-soft">Conversation complete. No more replies will be suggested. {canReopen(s).ok ? "If a customer has an important unresolved question or support need, you can reopen it for one more reply." : ""}</p>
              {canReopen(s).ok && <form action={reopenAction} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={o.id} /><input name="reason" required minLength={3} maxLength={500} placeholder="Why (e.g. billing question from a new customer)" className="field field-sm !w-80" /><button className={ghost}>Reopen conversation</button></form>}
            </div>
          )}
        </div>
      </Panel>
      <p className="text-xs text-muted"><Link href="/admin/marketing/radar/sources" className="underline">{src?.platform} rules</Link>: {src?.policyNotes}</p>
    </div>
  );
}
