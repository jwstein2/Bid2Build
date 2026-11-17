/**
 * Customer reply classification for communications. Builds on the creator-outreach rules, adds STOP
 * handling, and is conservative: anything that might be an opt-out is treated as one and flagged.
 */
import { classifyReply, newText } from "@/lib/creator/outreach/classify";

export type CommReplyClass = "human" | "auto_reply" | "bounce" | "opt_out" | "possible_opt_out";

export function classifyCommReply(input: { from?: string | null; subject?: string | null; text?: string | null }): CommReplyClass {
  const fresh = newText(input.text ?? "").trim();
  const firstLine = fresh.split("\n")[0]?.trim().toLowerCase() ?? "";
  if (/^(stop|stop all|end|quit|cancel|unsubscribe|remove|opt[- ]?out)[.!]?$/.test(firstLine)) return "opt_out";
  if (/\b(stop|quit) (emailing|contacting|sending|messaging)|\bremove me\b|\bunsubscribe\b|\bopt (me )?out\b|\bdo not (email|contact)\b|\bdon'?t (email|contact) me\b|\btake me off\b|\bno more emails\b/i.test(`${input.subject ?? ""}\n${fresh}`)) return "opt_out";
  const base = classifyReply(input);
  if (base === "bounce") return "bounce";
  if (base === "out_of_office") return "auto_reply";
  if (base === "unsubscribe") return "opt_out";
  if (base === "not_interested" || /\b(leave me alone|not interested|please stop|no longer interested|wrong person)\b/i.test(fresh)) return "possible_opt_out";
  return "human";
}

export const REPLY_CLASS_LABEL: Record<CommReplyClass, string> = {
  human: "Customer replied", auto_reply: "Automatic reply (out of office)", bounce: "Bounce notice", opt_out: "Asked to stop", possible_opt_out: "Possible opt-out (needs review)",
};
export { newText };
