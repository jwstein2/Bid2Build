import "server-only";
import { site } from "@/lib/site";
import { buildCtx, planFollowUp, renderKey, type CampaignKind, type Milestones, type Rendered } from "./templates";
import type { SendContext } from "./runner";
import { bookingRef } from "./tokens";

/**
 * What the next automatic email would say if it went out right now (the real one is chosen again at
 * send time, from the lead's activity at that moment). Null when the campaign would end instead.
 */
export function previewNext(ctx: SendContext, origin = site.url): { rendered: Rendered | null; endsAs: string | null } {
  const step = ctx.message.step;
  if (step === 0) return { rendered: null, endsAs: null };
  const plan = planFollowUp(ctx.campaign.kind as CampaignKind, step, ctx.milestones as Milestones);
  if (plan.action === "stop") return { rendered: null, endsAs: plan.reason };
  let ref: string | null = null;
  try { ref = bookingRef(ctx.campaign.id); } catch { ref = null; }
  const c = buildCtx({ contactName: ctx.lead.contact_name, companyName: ctx.lead.company_name, trades: ctx.lead.trades, rep: ctx.rep, origin, scheduleRef: ref });
  return { rendered: renderKey(plan.key, c), endsAs: null };
}
