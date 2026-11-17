import { z } from "zod";
import { fail, json, sameOrigin } from "@/lib/http/api";
import { site } from "@/lib/site";
import { buildAudience } from "@/lib/comms/eligibility";
import { renderNurture, validateTemplate } from "@/lib/comms/nurture";
import { accountBranding, loadContactFacts, loadEstimateFacts, loadOffers, loadSettings, loadSuppressions, requireComm } from "@/lib/comms/server";
import { localDate } from "@/lib/comms/time";

export const runtime = "nodejs";

const Body = z.object({ subject: z.string().max(200).nullable().optional(), body: z.string().max(4000).nullable().optional(), email: z.string().max(320).optional(), includeOffers: z.boolean().optional() }).strict();

/** Preview the follow-up for one real person in the audience (or the first eligible one). Sends nothing. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  const g = await requireComm("view_communications");
  if (!g.ok) return g.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "That request isn't valid.");
  const kind = g.access.kind === "company" ? "company" : "user";
  const [settings, estimates, contacts, suppressions, offers, brand] = await Promise.all([
    loadSettings(g.admin, g.access.accountId), loadEstimateFacts(g.admin, g.access.accountId, kind), loadContactFacts(g.admin, g.access.accountId), loadSuppressions(g.admin, g.access.accountId), loadOffers(g.admin, g.access.accountId), accountBranding(g.admin, g.access.accountId),
  ]);
  const subject = p.data.subject ?? settings.nurtureSubject, body = p.data.body ?? settings.nurtureBody;
  if ((p.data.subject || p.data.body) && validateTemplate(subject ?? "", body ?? "")) return fail(400, "invalid_template", validateTemplate(subject ?? "", body ?? "")!);
  const entries = buildAudience({ accountId: g.access.accountId, estimates, contacts, suppressions, now: new Date(), months: settings.nurtureMonths });
  const entry = (p.data.email && entries.find((e) => e.email === p.data.email!.toLowerCase())) || entries.find((e) => !e.excluded) || entries[0];
  if (!entry) return json({ preview: null, reason: "No past customers or bids with an email address yet." });
  const r = renderNurture(entry, {
    subject, body, offers, includeOffers: p.data.includeOffers ?? settings.nurtureIncludeOffers,
    ctx: { companyName: brand.companyName, senderName: settings.senderName || brand.contactName || brand.companyName, postalAddress: settings.postalAddress || "[your business postal address]", unsubscribeUrl: `${site.url}/email/preferences?…`, today: localDate(new Date(), settings.timezone) },
  });
  return json({ preview: { to: entry.name ? `${entry.name} <${entry.email}>` : entry.email, subject: r.subject, body: r.body, offer: r.facts.offer, email: entry.email, excluded: entry.excluded }, from: settings.senderName || brand.companyName });
}
