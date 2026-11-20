/**
 * Messenger side of the comment-to-trial funnel, written against small interfaces so it can be unit
 * tested without Meta or a database. The route wires in the Supabase store and the Graph client.
 *
 *   comment "BID" on an allowed post  -> one private reply with a "Send my invite" quick reply
 *   tap "Send my invite"               -> ask which email (Messenger's email quick reply), reminder in 4h
 *   send an email                      -> invite queued + emailed, ask about optional check-ins
 *   STOP                               -> opted out, no more automated messages
 *
 * Nothing here logs or stores message text, names or email addresses.
 */
import {
  allowedPostIds, MESSAGING_WINDOW_MS, PAYLOAD_CHECKINS_NO, PAYLOAD_CHECKINS_YES, PAYLOAD_SEND_INVITE,
  REMINDER_DELAY_MS, TRIAL_DAYS, type TrialConfig,
} from "./config";
import { extractEmail, isBidComment, isOptOut, isSendIntent, maskEmail } from "./text";

export interface Contact {
  id: string;
  state: "new" | "awaiting_email" | "invited" | "opted_out";
  invite_id: string | null;
  reminder_due_at: string | null;
  reminder_sent_at: string | null;
  last_inbound_at: string | null;
  invalid_email_prompts: number;
}

export type InviteStatus = "queued" | "resent" | "duplicate" | "limit" | "already_activated";

export interface FlowStore {
  /** Insert the event; null if this dedupe key was already seen (webhook retry, duplicate delivery). */
  claimEvent(e: { dedupeKey: string; kind: "comment" | "message" | "postback"; pageId: string; postId?: string; commentId?: string; occurredAt: Date }): Promise<{ id: number } | null>;
  finishEvent(id: number, patch: { status: "replied" | "failed" | "skipped" | "handled"; lastError?: string | null; replyFormat?: "quick_reply" | "text_only"; contactId?: string }): Promise<void>;
  findContact(pageId: string, psid: string): Promise<Contact | null>;
  /** Upsert the contact and record an inbound message now. */
  touchContact(pageId: string, psid: string, now: Date): Promise<Contact>;
  updateContact(id: string, patch: Partial<Omit<Contact, "id">> & { opted_out_at?: string | null }): Promise<void>;
  requestInvite(email: string, contactId: string): Promise<{ status: InviteStatus; inviteId: string }>;
  setCheckins(inviteId: string, optIn: boolean): Promise<void>;
}

export interface OutMessage { text: string; quick_replies?: { content_type: "text" | "user_email"; title?: string; payload?: string }[] }
export type SendResult = { ok: true } | { ok: false; retry: boolean; code?: number; error: string };

export interface FlowDeps {
  cfg: TrialConfig;
  store: FlowStore;
  privateReply(commentId: string, msg: OutMessage): Promise<SendResult>;
  message(psid: string, msg: OutMessage): Promise<SendResult>;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
const EMAIL_QR = [{ content_type: "user_email" as const }];

export const COPY = {
  privateReply: {
    text: `Thanks for commenting BID! Want ${TRIAL_DAYS} free days of Built2Bid Individual Unlimited? Tap "Send my invite" and I'll email you a link. No card needed and nothing is charged automatically.`,
    quick_replies: [{ content_type: "text" as const, title: "Send my invite", payload: PAYLOAD_SEND_INVITE }],
  },
  /** Used only if Meta rejects quick replies on a private reply. */
  privateReplyTextOnly: {
    text: `Thanks for commenting BID! Want ${TRIAL_DAYS} free days of Built2Bid Individual Unlimited? Reply "INVITE" and I'll email you a link. No card needed and nothing is charged automatically.`,
  },
  askEmail: {
    text: `Great! Which email should I send your invite to? I'll send one email from Built2Bid with a link that turns on ${TRIAL_DAYS} free days of Unlimited bids after you sign in. No card, no automatic charge. Reply STOP any time to stop messages.`,
    quick_replies: EMAIL_QR,
  },
  badEmail: { text: "That doesn't look like an email address. Type the email you'd like the invite sent to, or tap your email below.", quick_replies: EMAIL_QR },
  reminder: { text: `Still want your ${TRIAL_DAYS} free days of Built2Bid Individual Unlimited? Just send the email you'd like the invite sent to. Reply STOP to stop messages.`, quick_replies: EMAIL_QR },
  sent: (email: string): OutMessage => ({
    text: `Done! Your invite is on its way to ${maskEmail(email)}. Open it, tap "Activate my ${TRIAL_DAYS} days", and sign in with that email. Your ${TRIAL_DAYS} days start when you activate.\n\nWant two short emails during your trial (a quick walkthrough on day 2 and a reminder before it ends)?`,
    quick_replies: [
      { content_type: "text", title: "Yes, send tips", payload: PAYLOAD_CHECKINS_YES },
      { content_type: "text", title: "No thanks", payload: PAYLOAD_CHECKINS_NO },
    ],
  }),
  duplicate: (email: string): OutMessage => ({ text: `I just sent it to ${maskEmail(email)}. If it isn't there in a few minutes, check Spam or Promotions.` }),
  limit: (email: string): OutMessage => ({ text: `I've already sent a few invites to ${maskEmail(email)}. Please check Spam or Promotions, or send a different email address.` }),
  alreadyActivated: { text: "That email has already used its free week. Sign in at built2bid.org to pick up where you left off." },
  checkinsYes: { text: "You got it: two short emails, no more. Reply STOP here any time to stop Messenger messages." },
  checkinsNo: { text: "No problem, just the invite then. Enjoy Built2Bid!" },
  optedOut: { text: "You're unsubscribed. We won't send any more automated messages here." },
  resumed: { text: "Welcome back! Tap below if you'd like your invite.", quick_replies: [{ content_type: "text" as const, title: "Send my invite", payload: PAYLOAD_SEND_INVITE }] },
} satisfies Record<string, OutMessage | ((e: string) => OutMessage)>;

// ---------------------------------------------------------------------------
// Payload types (only the fields we read)
// ---------------------------------------------------------------------------
interface FeedValue { item?: string; verb?: string; post_id?: string; comment_id?: string; parent_id?: string; message?: string; from?: { id?: string }; created_time?: number }
interface MessagingEvent {
  sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; quick_reply?: { payload?: string } };
  postback?: { mid?: string; payload?: string };
}
export interface MetaPayload { object?: string; entry?: { id?: string; time?: number; changes?: { field?: string; value?: FeedValue }[]; messaging?: MessagingEvent[] }[] }

export interface ProcessSummary { comments: number; replied: number; ignored: number; messages: number; duplicates: number }

/** Handle one verified webhook delivery. Never throws for bad input; errors are recorded per event. */
export async function processMetaPayload(payload: MetaPayload, deps: FlowDeps): Promise<ProcessSummary> {
  const out: ProcessSummary = { comments: 0, replied: 0, ignored: 0, messages: 0, duplicates: 0 };
  if (payload?.object !== "page" || !Array.isArray(payload.entry)) return out;
  const { cfg } = deps;
  const posts = allowedPostIds(cfg);
  for (const entry of payload.entry) {
    if (!entry || String(entry.id) !== cfg.pageId) { out.ignored++; continue; }
    for (const ch of entry.changes ?? []) {
      const v = ch?.value;
      // New comments only: edits ("edited"), hides and removals are ignored.
      if (ch?.field !== "feed" || v?.item !== "comment" || v.verb !== "add") { out.ignored++; continue; }
      if (!v.comment_id || !v.post_id || !posts.has(v.post_id) || v.from?.id === cfg.pageId || !isBidComment(v.message)) { out.ignored++; continue; }
      out.comments++;
      const occurredAt = v.created_time ? new Date(v.created_time * 1000) : (deps.now?.() ?? new Date());
      const ev = await deps.store.claimEvent({ dedupeKey: `comment:${v.comment_id}`, kind: "comment", pageId: cfg.pageId, postId: v.post_id, commentId: v.comment_id, occurredAt });
      if (!ev) { out.duplicates++; continue; }
      if (await replyToComment(ev.id, v.comment_id, deps, v.post_id)) out.replied++;
    }
    for (const m of entry.messaging ?? []) {
      const psid = m?.sender?.id;
      if (!psid || psid === cfg.pageId || String(m.recipient?.id) !== cfg.pageId) { out.ignored++; continue; }
      if (m.message?.is_echo) { out.ignored++; continue; }
      const mid = m.message?.mid ?? m.postback?.mid;
      if (!mid) { out.ignored++; continue; } // delivery/read receipts etc.
      out.messages++;
      const ev = await deps.store.claimEvent({ dedupeKey: `mid:${mid}`, kind: m.postback ? "postback" : "message", pageId: cfg.pageId, occurredAt: new Date(m.timestamp ?? Date.now()) });
      if (!ev) { out.duplicates++; continue; }
      const payloadKey = m.message?.quick_reply?.payload ?? m.postback?.payload ?? null;
      const text = m.message?.text ?? null;
      try {
        const contactId = await handleInbound(psid, text, payloadKey, deps);
        await deps.store.finishEvent(ev.id, { status: "handled", contactId: contactId ?? undefined });
      } catch (e) {
        await deps.store.finishEvent(ev.id, { status: "failed", lastError: String((e as Error).message ?? e).slice(0, 300) });
      }
    }
  }
  return out;
}

/**
 * Link to the bid check questionnaire for a post (campaign = the post, trade hint from META_POST_TRADES).
 * No personal data in the URL.
 */
export function bidCheckUrl(cfg: TrialConfig, postId: string | null | undefined, origin = "https://built2bid.org"): string {
  const u = new URL("/bid-check", origin);
  const trade = postId ? cfg.postTrades[postId] : undefined;
  if (trade) u.searchParams.set("trade", trade);
  u.searchParams.set("utm_source", "facebook");
  u.searchParams.set("utm_medium", "messenger");
  u.searchParams.set("utm_campaign", trade ? `fb_bid_${trade.replace(/-/g, "_")}` : "fb_bid");
  if (postId) u.searchParams.set("utm_content", `post_${postId}`);
  return u.toString();
}

function withLink(msg: OutMessage, cfg: TrialConfig, postId?: string | null): OutMessage {
  if (!cfg.bidCheckLink) return msg;
  return { ...msg, text: `${msg.text}\n\nWant a quick tip for your next estimate first? Answer 6 questions: ${bidCheckUrl(cfg, postId)}` };
}

/** Send the one private reply for a claimed comment event. Also used by the retry job. */
export async function replyToComment(eventId: number, commentId: string, deps: FlowDeps, postId?: string | null): Promise<boolean> {
  let res = await deps.privateReply(commentId, withLink(COPY.privateReply, deps.cfg, postId));
  let format: "quick_reply" | "text_only" = "quick_reply";
  // Invalid-parameter rejection: fall back to plain text with a typed keyword.
  if (!res.ok && !res.retry && res.code === 100) {
    format = "text_only";
    res = await deps.privateReply(commentId, withLink(COPY.privateReplyTextOnly, deps.cfg, postId));
  }
  if (res.ok) {
    await deps.store.finishEvent(eventId, { status: "replied", replyFormat: format, lastError: null });
    return true;
  }
  await deps.store.finishEvent(eventId, { status: res.retry ? "failed" : "skipped", lastError: res.error });
  return false;
}

async function say(deps: FlowDeps, psid: string, msg: OutMessage) {
  const r = await deps.message(psid, msg);
  if (!r.ok && r.retry) throw new Error(r.error);
}

/** Returns the contact id it acted on, or null when the message isn't part of this funnel. */
export async function handleInbound(psid: string, text: string | null, payloadKey: string | null, deps: FlowDeps): Promise<string | null> {
  const { cfg, store } = deps;
  const now = deps.now?.() ?? new Date();
  const existing = await store.findContact(cfg.pageId, psid);
  const sendIntent = payloadKey === PAYLOAD_SEND_INVITE || isSendIntent(text);
  // Ordinary Page inbox messages from people who never entered the funnel are left for a human.
  if (!existing && !sendIntent) return null;

  const contact = await store.touchContact(cfg.pageId, psid, now);

  if (contact.state === "opted_out") {
    if (text && /^\s*start\s*$/i.test(text)) {
      await store.updateContact(contact.id, { state: contact.invite_id ? "invited" : "new", opted_out_at: null });
      await say(deps, psid, COPY.resumed);
    }
    return contact.id;
  }
  if (isOptOut(text)) {
    await store.updateContact(contact.id, { state: "opted_out", opted_out_at: now.toISOString(), reminder_due_at: null });
    if (contact.invite_id) await store.setCheckins(contact.invite_id, false);
    await say(deps, psid, COPY.optedOut);
    return contact.id;
  }
  if ((payloadKey === PAYLOAD_CHECKINS_YES || payloadKey === PAYLOAD_CHECKINS_NO) && contact.invite_id) {
    const yes = payloadKey === PAYLOAD_CHECKINS_YES;
    await store.setCheckins(contact.invite_id, yes);
    await say(deps, psid, yes ? COPY.checkinsYes : COPY.checkinsNo);
    return contact.id;
  }

  const email = extractEmail(payloadKey && payloadKey.includes("@") ? payloadKey : text);
  if (email) {
    const res = await store.requestInvite(email, contact.id);
    const reply = res.status === "queued" || res.status === "resent" ? COPY.sent(email)
      : res.status === "duplicate" ? COPY.duplicate(email)
      : res.status === "limit" ? COPY.limit(email)
      : COPY.alreadyActivated;
    await say(deps, psid, reply);
    return contact.id;
  }

  if (sendIntent && contact.state !== "invited") {
    const patch: Parameters<FlowStore["updateContact"]>[1] = { state: "awaiting_email" };
    // One reminder, ever, scheduled from the first time they asked.
    if (!contact.reminder_due_at && !contact.reminder_sent_at) patch.reminder_due_at = new Date(now.getTime() + REMINDER_DELAY_MS).toISOString();
    await store.updateContact(contact.id, patch);
    await say(deps, psid, COPY.askEmail);
    return contact.id;
  }

  if (contact.state === "awaiting_email" && text && contact.invalid_email_prompts < 2) {
    await store.updateContact(contact.id, { invalid_email_prompts: contact.invalid_email_prompts + 1 });
    await say(deps, psid, COPY.badEmail);
  }
  return contact.id;
}

/** Is a reminder still allowed for this contact right now? */
export function reminderAllowed(c: Pick<Contact, "state" | "reminder_due_at" | "reminder_sent_at" | "last_inbound_at">, now: Date): "send" | "wait" | "expired" | "no" {
  if (c.state !== "awaiting_email" || c.reminder_sent_at || !c.reminder_due_at) return "no";
  if (new Date(c.reminder_due_at) > now) return "wait";
  if (!c.last_inbound_at || now.getTime() - new Date(c.last_inbound_at).getTime() > MESSAGING_WINDOW_MS) return "expired";
  return "send";
}
