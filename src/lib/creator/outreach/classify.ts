/**
 * Rule-based reply classification. Deliberately conservative: anything unclear is "ambiguous" and goes
 * to the owner. It never returns "accepted": interest is not agreement to program terms, so only the
 * owner can mark a creator Accepted (and record their explicit acceptance) in the admin.
 */
export type ReplyClass = "interested" | "questions" | "not_interested" | "unsubscribe" | "out_of_office" | "bounce" | "ambiguous";

export const REPLY_LABELS: Record<ReplyClass, string> = {
  interested: "Interested",
  questions: "Has questions",
  not_interested: "Not interested",
  unsubscribe: "Unsubscribe",
  out_of_office: "Out of office",
  bounce: "Bounced",
  ambiguous: "Needs manual review",
};

const has = (s: string, re: RegExp) => re.test(s);

/** Remove quoted history ("On ... wrote:", lines starting with ">") so we classify the new text only. */
export function newText(body: string): string {
  const lines: string[] = [];
  for (const line of body.replace(/\r/g, "").split("\n")) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*On .{3,200}wrote:\s*$/i.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^From:\s/i.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n").trim().slice(0, 5000);
}

export function classifyReply(input: { from?: string | null; subject?: string | null; text?: string | null }): ReplyClass {
  const from = (input.from ?? "").toLowerCase();
  const subject = (input.subject ?? "").toLowerCase();
  const text = newText(input.text ?? "").toLowerCase();
  const all = `${subject}\n${text}`;

  if (has(from, /mailer-daemon|postmaster@/) || has(subject, /undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail|delivery failure|address not found/)) return "bounce";
  if (has(subject, /automatic reply|auto[- ]?reply|out of (the )?office|autoreply/) || has(text, /\b(i am|i'm|i will be) (currently )?(out of (the )?office|away|on vacation|traveling)\b|limited access to (my )?email|auto(matic)?[- ]reply/)) return "out_of_office";
  if (has(all, /\bunsubscribe\b|remove me|take me off|stop (emailing|contacting|sending)|do not (email|contact)|don'?t (email|contact) me/)) return "unsubscribe";
  if (has(text, /\bnot interested\b|\bno,? thanks?\b|\bno thank you\b|\bpass on this\b|\bwe'?ll pass\b|\bnot (a )?(good )?fit\b|\bnot for (us|me)\b|\bnot at this time\b|\bplease don'?t\b/)) return "not_interested";
  const positive = has(text, /\binterested\b|\bsounds (good|great|interesting)\b|\blet'?s (talk|chat|do it|connect)\b|\btell me more\b|\bcount (me|us) in\b|\byes\b|\bhappy to\b|\b(would|i'?d|we'?d) love\b|\bsign me up\b|\bopen to\b/);
  const question = text.includes("?");
  if (positive && question) return "questions";
  if (positive) return "interested";
  if (question && text.length > 8) return "questions";
  return "ambiguous";
}

/** Prospect stage for a classification (null = no stage change, e.g. out of office). */
export function stageForReply(c: ReplyClass): string | null {
  switch (c) {
    case "interested": return "interested";
    case "questions": return "questions";
    case "not_interested": return "declined";
    case "unsubscribe": return "unsubscribed";
    case "bounce": return "bounced";
    case "ambiguous": return "needs_review";
    case "out_of_office": return null;
  }
}
