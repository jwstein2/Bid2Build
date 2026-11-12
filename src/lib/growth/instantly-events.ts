/**
 * Mapping from Instantly webhook events to lead lifecycle changes. Pure (no server imports) so it is
 * unit-tested. Event names from developer.instantly.ai/guides/webhook-events (checked 2026-11-12).
 */
import type { LeadStage } from "./leads";

export interface InstantlyEffect {
  stage?: LeadStage;
  suppress?: "unsubscribed" | "bounced";
  /** Push the email to the Instantly block list as well (opt-outs must stick everywhere). */
  block?: boolean;
}

export function effectOf(eventType: string): InstantlyEffect {
  switch (eventType) {
    case "email_sent": return { stage: "contacted" };
    case "email_opened":
    case "email_link_clicked": return { stage: "engaged" };
    case "reply_received": return { stage: "replied" };
    case "lead_interested":
    case "lead_meeting_booked":
    case "lead_meeting_completed": return { stage: "interested" };
    case "lead_unsubscribed": return { suppress: "unsubscribed", block: true };
    case "email_bounced": return { suppress: "bounced" };
    default: return {};
  }
}

export interface InstantlyPayload {
  timestamp?: string;
  event_type?: string;
  workspace?: string;
  campaign_id?: string;
  campaign_name?: string;
  lead_email?: string;
  email_id?: string;
  step?: number;
  variant?: number;
}
