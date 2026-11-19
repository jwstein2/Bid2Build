/**
 * V8.4 work-preferences and recognition survey. Optional, editable any time, and used only to adapt how
 * the Sales Hub presents things (layout order, how we celebrate, which rewards to suggest). It is not a
 * psychological, personality or suitability assessment, it produces no score, and answers never affect
 * pay, leads, opportunities or any decision about a rep.
 *
 * The questions are our own, written around widely used workplace motivation ideas (autonomy,
 * competence, relatedness, practical goal setting, individual recognition preferences). They are not
 * copied from any published instrument and are not validated.
 */

export type Opt = { v: string; label: string };
export type Question =
  | { id: string; kind: "one"; text: string; help?: string; options: Opt[] }
  | { id: string; kind: "many"; text: string; help?: string; options: Opt[]; max: number }
  | { id: string; kind: "text"; text: string; help?: string; max: number; personal?: boolean };

export const QUESTIONS: Question[] = [
  { id: "q1", kind: "one", text: "What mainly motivates you to grow your sales business?", options: [
    { v: "achievement", label: "Hitting goals and beating my own records" }, { v: "money", label: "Earning more and seeing exactly where it comes from" },
    { v: "team", label: "Being part of a team that wins together" }, { v: "independence", label: "Running my own book of customers my way" },
    { v: "impact", label: "Helping contractors succeed" }] },
  { id: "q2", kind: "many", max: 2, text: "Which makes a day feel rewarding?", options: [
    { v: "closed_sale", label: "Closing a sale" }, { v: "good_conversation", label: "A great conversation with a prospect" },
    { v: "customer_win", label: "A customer telling me it helped" }, { v: "list_done", label: "Getting through my list" }, { v: "learned", label: "Learning something new" }] },
  { id: "q3", kind: "many", max: 2, text: "How do you like to celebrate an achievement?", options: [
    { v: "quiet_note", label: "A quick personal note" }, { v: "badge", label: "A badge on my dashboard" }, { v: "shout_out", label: "A team shout-out" },
    { v: "reward", label: "A small reward" }, { v: "none", label: "Just keep going, no fuss" }] },
  { id: "q4", kind: "one", text: "Public or private recognition?", options: [
    { v: "private", label: "Private" }, { v: "public", label: "Public is fine" }, { v: "depends", label: "Depends on the achievement" }] },
  { id: "q5", kind: "one", text: "What kind of goals motivate you most?", options: [
    { v: "stretch", label: "Stretch goals" }, { v: "steady", label: "Steady, realistic goals" }, { v: "own", label: "Goals I set myself" }, { v: "none", label: "I prefer not to set goals" }] },
  { id: "q6", kind: "one", text: "Do you enjoy competition, collaboration or individual progress?", options: [
    { v: "competition", label: "Friendly competition" }, { v: "collaboration", label: "Collaboration" }, { v: "individual", label: "My own progress" }] },
  { id: "q7", kind: "one", text: "How often do you want progress updates?", options: [
    { v: "daily", label: "Daily" }, { v: "weekly", label: "Weekly" }, { v: "monthly", label: "Monthly" }, { v: "on_demand", label: "Only when I look" }] },
  { id: "q8", kind: "one", text: "What kind of feedback helps you improve?", options: [
    { v: "direct", label: "Direct and specific" }, { v: "examples", label: "Examples of what worked" }, { v: "questions", label: "Questions that help me think it through" }, { v: "written", label: "Written notes I can read later" }] },
  { id: "q9", kind: "one", text: "Charts, checklists or simple summaries?", options: [
    { v: "charts", label: "Charts" }, { v: "checklists", label: "Checklists" }, { v: "summaries", label: "Simple summaries" }] },
  { id: "q10", kind: "text", max: 300, text: "What would make you proud in your first 90 days?" },
  { id: "q11", kind: "many", max: 3, text: "Which rewards feel most meaningful?", options: [
    { v: "gift_card", label: "Gift cards" }, { v: "experience", label: "Experiences" }, { v: "restaurant", label: "Restaurants" },
    { v: "outdoor_hobby", label: "Outdoor or hobby gear" }, { v: "training", label: "Professional training" }, { v: "conference", label: "Conferences" },
    { v: "equipment", label: "Work equipment" }, { v: "cash", label: "Cash, where offered" }] },
  { id: "q12", kind: "one", text: "If you could pick one: cash, experiences, learning or gifts?", options: [
    { v: "cash", label: "Cash" }, { v: "experiences", label: "Experiences" }, { v: "learning", label: "Learning opportunities" }, { v: "gifts", label: "Gifts" }] },
  { id: "q13", kind: "text", max: 300, personal: true, text: "Hobbies or interests you'd like to share", help: "Optional. Helps pick rewards you'd actually enjoy." },
  { id: "q14", kind: "text", max: 300, personal: true, text: "What kinds of experiences do you enjoy?", help: "Optional." },
  { id: "q15", kind: "text", max: 120, personal: true, text: "A favorite store or gift-card category", help: "Optional." },
  { id: "q16", kind: "one", text: "How would you like the owner to congratulate you?", options: [
    { v: "email", label: "A short email" }, { v: "call", label: "A quick call" }, { v: "in_app", label: "A note in the Sales Hub" }, { v: "none", label: "No need" }] },
  { id: "q17", kind: "one", text: "Include you in public team celebrations?", options: [
    { v: "yes", label: "Yes" }, { v: "ask", label: "Ask me each time" }, { v: "no", label: "No thanks" }] },
  { id: "q18", kind: "one", text: "Preferred style of communication", options: [
    { v: "email", label: "Email" }, { v: "text", label: "Text" }, { v: "call", label: "Phone call" }, { v: "in_app", label: "Sales Hub messages" }] },
  { id: "q19", kind: "many", max: 2, text: "What helps you stay engaged during slower periods?", options: [
    { v: "small_goals", label: "Small, quick goals" }, { v: "learning", label: "Learning new skills" }, { v: "check_in", label: "A check-in with someone" },
    { v: "flexibility", label: "Flexibility to step back and reset" }, { v: "progress", label: "Seeing my progress so far" }] },
  { id: "q20", kind: "text", max: 500, personal: true, text: "Anything else you'd like Built2Bid to know about supporting and recognizing you?", help: "Optional. Please don't include health, family or financial details." },
];

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
export type Answers = Record<string, string | string[]>;

/** Keeps only known questions and known options, trimmed to their limits. */
export function cleanAnswers(raw: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const [id, v] of Object.entries(raw)) {
    const q = BY_ID.get(id);
    if (!q) continue;
    if (q.kind === "text") {
      const s = typeof v === "string" ? v.trim().slice(0, q.max) : "";
      if (s) out[id] = s;
    } else {
      const allowed = new Set(q.options.map((o) => o.v));
      const vals = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && allowed.has(x));
      if (q.kind === "one" && vals[0]) out[id] = vals[0];
      if (q.kind === "many" && vals.length) out[id] = [...new Set(vals)].slice(0, q.max);
    }
  }
  return out;
}

export function answeredCount(a: Answers): number {
  return QUESTIONS.filter((q) => a[q.id] !== undefined && a[q.id] !== "").length;
}

export const LAYOUTS = [
  { v: "progress", label: "Progress first", help: "Personal records, milestone boxes and goals at the top." },
  { v: "earnings", label: "Earnings first", help: "Pending, earned and paid commissions at the top." },
  { v: "team", label: "Team first", help: "The team goal and shared milestones at the top." },
  { v: "portfolio", label: "My customers first", help: "Your link, funnel and customer successes at the top." },
] as const;
export type Layout = (typeof LAYOUTS)[number]["v"];

/** A suggestion from the first answer only; the rep can always pick another. */
export function recommendedLayout(a: Answers): Layout {
  switch (a.q1) {
    case "money": return "earnings";
    case "team": return "team";
    case "independence": case "impact": return "portfolio";
    default: return "progress";
  }
}

/** Section order for the overview. Every section is always shown; only the order changes. */
export function sectionOrder(layout: Layout): ("team" | "progress" | "portfolio" | "earnings")[] {
  const base = { progress: ["progress", "earnings", "portfolio", "team"], earnings: ["earnings", "progress", "portfolio", "team"],
    team: ["team", "progress", "earnings", "portfolio"], portfolio: ["portfolio", "earnings", "progress", "team"] } as const;
  return [...base[layout]];
}

const label = (id: string, v: string | string[] | undefined) => {
  const q = BY_ID.get(id);
  if (!q || v === undefined || q.kind === "text") return typeof v === "string" ? v : undefined;
  const one = (x: string) => q.options.find((o) => o.v === x)?.label ?? x;
  return Array.isArray(v) ? v.map(one).join(", ") : one(v);
};

/** The plain-language profile summary the rep sees. No types, labels or scores. */
export function preferenceSummary(a: Answers): { label: string; value: string }[] {
  const rows: [string, string | undefined][] = [
    ["What motivates you", label("q1", a.q1)],
    ["How you like to be recognized", [label("q3", a.q3), label("q4", a.q4)].filter(Boolean).join(" · ") || undefined],
    ["Rewards you'd enjoy", [label("q11", a.q11), label("q12", a.q12)].filter(Boolean).join(" · ") || undefined],
    ["Communication", [label("q18", a.q18), label("q7", a.q7) && `updates ${label("q7", a.q7)!.toLowerCase()}`].filter(Boolean).join(" · ") || undefined],
    ["Hobbies and interests", a.q13 as string | undefined],
    ["Your 90-day goal", a.q10 as string | undefined],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]).map(([l, value]) => ({ label: l, value }));
}

export const SUCCESS_TEXT: Record<string, { title: string; body: string }> = {
  first_estimate: { title: "First real estimate", body: "built their first estimate with priced line items." },
  first_proposal: { title: "First proposal out", body: "sent or exported their first proposal." },
  activated: { title: "Customer activated", body: "met Built2Bid's 7-day activation goal." },
  onboarding_complete: { title: "Onboarding complete", body: "made it through onboarding: a real estimate and a proposal in a client's hands." },
};

export const REWARD_CATEGORIES: Record<string, string> = {
  gift_card: "Gift card", experience: "Experience", restaurant: "Restaurant", outdoor_hobby: "Outdoor and hobby",
  training: "Professional training", conference: "Conference", equipment: "Work equipment", cash: "Cash",
};

export const TAX_LABELS: Record<string, string> = {
  taxable_cash: "Cash: taxable, paid on a statement",
  taxable_cash_equivalent: "Cash equivalent (gift card): taxable",
  taxable_noncash: "Non-cash: taxable at fair value",
  de_minimis: "De minimis non-cash (check with your accountant)",
  working_condition: "Work tool or training (check with your accountant)",
};

export const AWARD_STATUS: Record<string, string> = {
  proposed: "Proposed", authorized: "Authorized", ordered: "Ordered", delivered: "Delivered", canceled: "Canceled",
};

/** Error messages for the admin Recognition actions (shared with the admin page). */
export const RECOGNITION_ERRORS: Record<string, string> = {
  not_authorized: "Your role can't do that. Rewards, congratulations emails and their settings are the platform owner's.",
  cannot_approve_own: "You can't award yourself. Another administrator or the owner has to.",
  congrats_disabled: "Owner congratulation emails are off. Turn them on in the settings below first.",
  not_sendable: "That email was already sent or is sending.",
  too_many_attempts: "That email failed 5 times. Skip it and congratulate another way.",
  text_required: "Add a subject and message.",
  reward_unavailable: "Pick an active reward.",
  already_awarded: "That win already has a reward.",
  reason_required: "Add a short reason.",
  invalid_transition: "That award can't move to that status.",
  already_paid: "The cash reward is already on an approved or paid statement, so it can't be canceled here.",
  not_skippable: "That email can't be skipped now.",
  rep_busy: "That rep is busy or out of office at that time. Pick someone else.",
  send_failed: "The email didn't send. It's marked failed; you can try again.",
  invalid: "Check the form and try again.",
};
