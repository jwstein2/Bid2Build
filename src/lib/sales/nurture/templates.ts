/**
 * Sales Hub follow-up and nurture emails: the approved templates and the rules that pick one.
 * Pure functions (no I/O) shared by the composer, the scheduler, the admin review page and tests.
 *
 *   Answered call -> follow-up:  first email (rep reviews), day 3 (activity based), day 7 (final)
 *   No answer     -> nurture:    first email (rep reviews), day 3 (product intro), day 7 (final)
 *
 * Rules that keep every email truthful:
 *   * A follow-up is chosen right before it sends, from verified milestones of the account LINKED to
 *     the lead (signed up through the rep's link). An account found only by email is "account exists"
 *     and gets neutral wording plus the login link (never the sign-up link again).
 *   * No milestone, no claim: unknown activity uses "If you haven't had a chance..." wording.
 *   * Paid customers get nothing more (the campaign ends as converted).
 *   * No AI. Fixed templates with conditional lines, so nothing can invent activity, promises or discounts.
 */

export type CampaignKind = "answered" | "no_answer";
export type Milestone = "none" | "account_exists" | "account_created" | "estimate_started" | "estimate_completed" | "proposal_sent" | "proposal_approved" | "paid";

export interface Milestones {
  match?: "linked" | "email_account" | "none";
  top: Milestone;
  paid: boolean;
}

export interface TemplateCtx {
  firstName: string | null;
  companyName: string;
  /** Verified trade from the CRM record, if any (used only as a word in the first email). */
  trade: string | null;
  rep: { name: string; email: string; phone?: string | null };
  /** The rep's own tracked link: /s/<code>?to=/login (existing attribution, 90-day cookie). */
  signupLink: string;
  /** Sign-in page for people who already have an account. */
  loginLink: string;
  /** The rep's booking page for a walkthrough, or null when the rep hasn't turned booking on. */
  scheduleLink: string | null;
}

export interface Rendered { key: string; subject: string; body: string }

export const MILESTONE_LABEL: Record<Milestone, string> = {
  none: "No verified activity", account_exists: "Has an account (not linked to this lead)", account_created: "Account created",
  estimate_started: "Estimate started", estimate_completed: "Estimate completed", proposal_sent: "Proposal sent", proposal_approved: "Proposal approved", paid: "Paying customer",
};

export const STATUS_LABEL: Record<string, string> = {
  not_enrolled: "Not enrolled", active: "Active", paused: "Paused", completed: "Completed", replied: "Replied", meeting_scheduled: "Meeting scheduled",
  converted: "Converted", unsubscribed: "Unsubscribed", not_interested: "Not interested", stopped: "Stopped", failed_delivery: "Failed delivery",
};
export const KIND_LABEL: Record<CampaignKind, string> = { answered: "Follow-up", no_answer: "Nurture" };

export function firstNameOf(contact: string | null | undefined): string | null {
  const n = (contact ?? "").trim().split(/\s+/)[0] ?? "";
  // Only a real-looking given name; never "Owner", initials or a company word.
  return /^[A-Za-z][A-Za-z'’-]{1,29}$/.test(n) && !/^(owner|manager|office|info|sales|admin|contact|the|mr|mrs|ms|dr)$/i.test(n) ? n[0].toUpperCase() + n.slice(1) : null;
}

export function signature(rep: TemplateCtx["rep"]): string {
  return [rep.name, "Built2Bid", [rep.email, rep.phone].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
}

const hi = (c: TemplateCtx) => `Hi ${c.firstName ?? "there"},`;
const join = (...parts: (string | null | false | undefined)[]) => parts.filter((p): p is string => typeof p === "string").join("\n\n");
/** "You can schedule a time with me here: <link>" or a reply line when the rep has no booking page. */
const schedule = (c: TemplateCtx, lead: string, fallback = "Just reply with a day and time that works for you.") => (c.scheduleLink ? `${lead}\n${c.scheduleLink}` : fallback);

// ------------------------------------------------------------------------------------------------
// First emails (the rep reviews and edits these in the composer)
// ------------------------------------------------------------------------------------------------
export function answeredInitial(c: TemplateCtx, opts: { hasAccount?: boolean } = {}): Rendered {
  const tradeWord = c.trade ? `${c.trade} estimates` : "estimates";
  return {
    key: "answered_initial",
    subject: "Great speaking with you today — Built2Bid",
    body: join(hi(c), "Thanks for taking my call today!",
      `As we discussed, Built2Bid could be a valuable resource for ${c.companyName}, particularly when it comes to creating ${tradeWord}, managing bids, and keeping projects organized.`,
      "We built Built2Bid specifically for contractors who want to spend less time on paperwork and more time getting work done.",
      opts.hasAccount ? `You can sign in here any time:\n${c.loginLink}` : `Here's your personal link to get started:\n${c.signupLink}`,
      opts.hasAccount ? "Try the estimating tools and see how they fit your business." : "You can create an account and try the estimating tools to see how they fit your business.",
      "Thanks again for your time. If you have any questions, just reply to this email. I'm happy to help!",
      signature(c.rep)),
  };
}

export function noAnswerInitial(c: TemplateCtx): Rendered {
  return {
    key: "no_answer_initial",
    subject: `Quick question about ${c.companyName}`,
    body: join(hi(c), "I tried reaching you today and wanted to introduce myself.",
      `I'm ${c.rep.name} with Built2Bid, a contractor estimating and project management platform.`,
      `I was hoping to connect with the owner or whoever handles estimating and bidding for ${c.companyName}.`,
      "We help contractors simplify estimates, organize projects, and reduce the need to jump between multiple systems.",
      "I'd love to learn a little about how you're currently handling estimates and whether Built2Bid might be a good fit.",
      "If there's a better person to speak with, I'd appreciate being pointed in the right direction.",
      "Thanks for your time!", signature(c.rep)),
  };
}

// ------------------------------------------------------------------------------------------------
// Automated follow-ups
// ------------------------------------------------------------------------------------------------
const T: Record<string, (c: TemplateCtx) => Omit<Rendered, "key">> = {
  // Answered, day 3
  answered_d3_none: (c) => ({ subject: "Any questions about Built2Bid?", body: join(hi(c), "I wanted to follow up after our conversation.",
    "I know things get busy, especially when you're managing projects and taking care of customers.",
    `If you haven't had a chance to try Built2Bid yet, here's your link:\n${c.signupLink}`,
    c.scheduleLink ? `If you'd prefer, I'd be happy to walk you through creating your first estimate.\n\nYou can schedule a time with me here:\n${c.scheduleLink}` : "If you'd prefer, I'd be happy to walk you through creating your first estimate. Just reply with a time that works for you.",
    "Thanks!", signature(c.rep)) }),
  // Has an account we can't link to this lead: neutral, and never the sign-up link again.
  answered_d3_account_exists: (c) => ({ subject: "Any questions about Built2Bid?", body: join(hi(c), "I wanted to follow up after our conversation.",
    "I know things get busy, especially when you're managing projects and taking care of customers.",
    `Whenever you're ready, you can sign in here:\n${c.loginLink}`,
    c.scheduleLink ? `If it would help, I'm happy to walk you through building an estimate.\n\nYou can schedule a time with me here:\n${c.scheduleLink}` : "If it would help, I'm happy to walk you through building an estimate. Just reply with a time that works for you.",
    "Thanks!", signature(c.rep)) }),
  answered_d3_account_created: (c) => ({ subject: "Ready to try your first estimate?", body: join(hi(c), "Thanks for getting started with Built2Bid!",
    "I noticed you created an account but haven't started an estimate yet.",
    "If you'd like, I can walk you through the process and show you how to build your first bid.",
    `You can get started here:\n${c.loginLink}`, schedule(c, "Or schedule a quick walkthrough:", "Or just reply and we'll set up a quick walkthrough."),
    "Let me know if there's anything I can do to help.", signature(c.rep)) }),
  answered_d3_estimate_started: (c) => ({ subject: "How's your first Built2Bid estimate going?", body: join(hi(c), "I saw that you've started exploring the estimating tools in Built2Bid.",
    "How has the experience been so far?",
    "If you've run into any questions or want a hand getting your estimate finished, I'd be happy to help.",
    `You can continue here:\n${c.loginLink}`, schedule(c, "Or grab some time on my calendar:", "Or just reply and we'll find a time."), signature(c.rep)) }),
  answered_d3_estimate_completed: (c) => ({ subject: "How did your first Built2Bid estimate go?", body: join(hi(c), "I noticed you've completed your first estimate in Built2Bid!",
    "I'd love to hear how it went and whether the process helped make things easier for you.",
    "If you have feedback, questions, or ideas about how we could make it better, I'd be happy to hear them.",
    "Thanks again for giving Built2Bid a try!", signature(c.rep)) }),
  answered_d3_proposal_sent: (c) => ({ subject: "How's Built2Bid working for your proposals?", body: join(hi(c), "I noticed you've sent a proposal from Built2Bid!",
    "I'd love to hear how it went and whether the process helped make things easier for you.",
    "If you have feedback, questions, or ideas about how we could make it better, I'd be happy to hear them.",
    "Thanks again for giving Built2Bid a try!", signature(c.rep)) }),
  answered_d3_proposal_approved: (c) => ({ subject: "Congrats on your approved Built2Bid proposal", body: join(hi(c), "I noticed one of your Built2Bid proposals was approved. Congratulations!",
    "I'd love to hear how the process went and whether it made things easier for you.",
    "If you have feedback, questions, or ideas about how we could make it better, I'd be happy to hear them.",
    "Thanks again for giving Built2Bid a try!", signature(c.rep)) }),

  // Answered, day 7 (final). Acknowledges the most relevant milestone without repeating day 3.
  answered_d7_none: (c) => ({ subject: "Happy to help whenever you're ready", body: join(hi(c), "Just wanted to check in one last time.",
    "If you'd like a quick walkthrough of Built2Bid or want to see how it could fit your estimating process, I'm happy to help.",
    schedule(c, "Here's my calendar if you'd like to connect:", "Just reply if you'd like to connect."),
    "Otherwise, feel free to reach out whenever the timing is better.", "Thanks again!", signature(c.rep)) }),
  answered_d7_account_exists: (c) => ({ subject: "Happy to help whenever you're ready", body: join(hi(c), "Just wanted to check in one last time.",
    "If a quick walkthrough would help you get more out of Built2Bid, I'm happy to set one up.",
    schedule(c, "Here's my calendar if you'd like to connect:", "Just reply if you'd like to connect."),
    "Otherwise, feel free to reach out whenever the timing is better.", "Thanks again!", signature(c.rep)) }),
  answered_d7_account_created: (c) => ({ subject: "Want a hand with your first estimate?", body: join(hi(c), "Just wanted to check in one last time.",
    "Your Built2Bid account is ready whenever you are. If it would help, I can walk you through building your first estimate in a few minutes.",
    schedule(c, "Here's my calendar:", "Just reply with a time that works."), "Otherwise, feel free to reach out whenever the timing is better.", "Thanks again!", signature(c.rep)) }),
  answered_d7_estimate_started: (c) => ({ subject: "Need a hand finishing your estimate?", body: join(hi(c), "Just wanted to check in one last time.",
    "If anything is slowing down the estimate you started, I'm happy to walk through it with you and get it finished.",
    `You can pick up where you left off here:\n${c.loginLink}`, schedule(c, "Or grab a time with me:", "Or just reply and we'll find a time."), "Thanks again!", signature(c.rep)) }),
  answered_d7_progress: (c) => ({ subject: "Anything I can help with?", body: join(hi(c), "Just wanted to check in one last time.",
    "It's great to see you putting Built2Bid to work. If there's anything that would make it more useful for your business, I'd like to hear it.",
    schedule(c, "If a quick call would help, here's my calendar:", "If a quick call would help, just reply."), "Thanks again!", signature(c.rep)) }),

  // No answer, day 3 (product intro) and day 7 (final contact attempt).
  no_answer_d3: (c) => ({ subject: "A simpler way to handle estimating?", body: join(hi(c), "Following up on my earlier email.",
    "Built2Bid gives contractors a straightforward way to create estimates, manage proposals, and keep projects organized.",
    `If you'd like to take a look, you can create an account here:\n${c.signupLink}`,
    "You can explore the platform and see whether it works for your business.", "If you have any questions, feel free to reply.", signature(c.rep)) }),
  no_answer_d3_account_exists: (c) => ({ subject: "A simpler way to handle estimating?", body: join(hi(c), "Following up on my earlier email.",
    "Built2Bid gives contractors a straightforward way to create estimates, manage proposals, and keep projects organized.",
    `You can sign in and take a look here:\n${c.loginLink}`, "If you have any questions, feel free to reply.", signature(c.rep)) }),
  no_answer_d7: (c) => ({ subject: "Is there a better time to connect?", body: join(hi(c), "I wanted to reach out one last time.",
    "I haven't been able to connect with you, but I'd be happy to show you how Built2Bid works if you're interested.",
    c.scheduleLink ? `If there's a convenient time to talk, you can schedule directly with me here:\n${c.scheduleLink}` : "If there's a convenient time to talk, just reply with a day and time that works for you.",
    "Otherwise, no worries. I appreciate your time!", signature(c.rep)) }),
};

export const FOLLOW_UP_KEYS = Object.keys(T);

export function renderKey(key: string, c: TemplateCtx): Rendered {
  if (key === "answered_initial") return answeredInitial(c);
  if (key === "no_answer_initial") return noAnswerInitial(c);
  const t = T[key];
  if (!t) throw new Error(`unknown template ${key}`);
  return { key, ...t(c) };
}

export type Plan = { action: "send"; key: string } | { action: "stop"; status: "converted" | "completed"; reason: string };

/**
 * Which follow-up (step 1 = day 3, step 2 = day 7) fits the lead's verified milestones right now.
 * Most advanced milestone wins: paid > approved > sent > completed > started > account > none.
 */
export function planFollowUp(kind: CampaignKind, step: 1 | 2, m: Milestones): Plan {
  if (m.paid || m.top === "paid") return { action: "stop", status: "converted", reason: "Became a paying customer" };
  const top = m.top;
  if (kind === "answered") {
    if (step === 1) return { action: "send", key: `answered_d3_${top}` };
    const d7 = top === "none" || top === "account_exists" || top === "account_created" || top === "estimate_started" ? top : "progress";
    return { action: "send", key: `answered_d7_${d7}` };
  }
  if (step === 1) {
    if (top === "none") return { action: "send", key: "no_answer_d3" };
    if (top === "account_exists") return { action: "send", key: "no_answer_d3_account_exists" };
    // They signed up through the rep's link since: talk about where they are, not about signing up.
    return { action: "send", key: `answered_d3_${top}` };
  }
  return { action: "send", key: "no_answer_d7" };
}

/** CAN-SPAM footer: who is sending, a valid postal address, and a working opt-out. Not editable by reps. */
export function footer(o: { companyName: string; postalAddress: string; unsubscribeUrl: string; repFirstName: string }): string {
  return `\n\n--\nBuilt2Bid L.L.C. · ${o.postalAddress}\nYou're receiving this because ${o.repFirstName} from Built2Bid reached out to ${o.companyName}. To stop these emails, unsubscribe here: ${o.unsubscribeUrl}\n(or reply "unsubscribe").`;
}

/** Placeholders that must never go out. */
export const unresolved = (text: string) => [...new Set(text.match(/\{\{[^}]*\}\}/g) ?? [])];

export function buildCtx(input: {
  contactName: string | null; companyName: string; trades: string[] | null; rep: { full_name: string; email: string; phone?: string | null; code: string; booking_slug?: string | null };
  origin: string; scheduleRef?: string | null;
}): TemplateCtx {
  const base = input.origin.replace(/\/+$/, "");
  const trade = (input.trades ?? []).find((t) => /^[a-z][a-z /&-]{2,30}$/i.test(t)) ?? null;
  return {
    firstName: firstNameOf(input.contactName), companyName: input.companyName.trim(), trade: trade && trade !== "general contracting" ? trade.toLowerCase() : null,
    rep: { name: input.rep.full_name, email: input.rep.email, phone: input.rep.phone ?? null },
    signupLink: `${base}/s/${encodeURIComponent(input.rep.code)}?to=/login`,
    loginLink: `${base}/login`,
    scheduleLink: input.rep.booking_slug ? `${base}/meet/${encodeURIComponent(input.rep.booking_slug)}?session=intro${input.scheduleRef ? `&ref=${encodeURIComponent(input.scheduleRef)}` : ""}` : null,
  };
}

/** Labels for the five call outcomes on the lead page. */
export const CALL_OUTCOMES = [
  { v: "answered", label: "Answered — Start Follow-Up", disposition: "connected" },
  { v: "no_answer", label: "No Answer — Start Nurture", disposition: "no_answer" },
  { v: "not_interested", label: "Not Interested — Do Not Follow Up", disposition: "connected" },
  { v: "callback", label: "Callback Requested — Schedule Callback", disposition: "connected" },
  { v: "wrong_number", label: "Wrong Number / Invalid Contact", disposition: "wrong_number" },
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number]["v"];

/** Why a campaign can't start, in plain words for the rep. */
export const START_BLOCK_LABEL: Record<string, string> = {
  not_ready: "Follow-up emails aren't switched on yet. An administrator turns them on in the Admin Sales Hub.",
  no_sender: "Follow-up emails are off for you until an administrator assigns your @built2bid.org email address (Admin Sales Hub → Follow-up emails).",
  not_your_lead: "Only the rep this lead is assigned to can email it.",
  no_email: "Add an email address for this lead first.",
  bounced: "This email address bounced or can't receive mail. Reach them by phone.",
  opted_out: "This address opted out of sales emails.",
  customer: "This business is already a paying Built2Bid customer. Onboarding takes it from here.",
  other_campaign: "Another lead with this email address is already in a campaign.",
  already_active: "A campaign is already running for this lead.",
  already_ran: "This campaign already ran for this lead. Completed sequences don't restart.",
  paused: "An administrator paused all follow-up emails.",
  not_test_recipient: "Test mode: only the administrator's test addresses can receive emails right now.",
  rep_limit: "You've reached today's sending limit. Try again tomorrow.",
  unfilled_placeholder: "Replace every {{placeholder}} before sending.",
  invalid_email: "The subject or message is too short or too long.",
};

/** Admin settings errors (Admin Sales Hub → Follow-up emails). */
export const NURTURE_ERRORS: Record<string, string> = {
  nurture_owner_only: "Only the platform owner can switch on live sending.",
  nurture_templates_not_approved: "Approve the email templates before choosing live sending.",
  nurture_no_postal_address: "Add the company postal address (required in every commercial email) before choosing live sending.",
  nurture_confirm_live: "Tick the box confirming you tested with test addresses and want real leads to receive emails.",
  nurture_too_many_test_recipients: "Use 20 or fewer test addresses.",
  nurture_not_built2bid_address: "Use an @built2bid.org address.",
  nurture_address_in_use: "That address is already assigned to another rep.",
  nurture_invalid: "Check the numbers: day 7 must come after day 3, and the end hour after the start hour.",
};
