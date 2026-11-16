/**
 * Import creator research (the research thread's creators_seed.json and outreach_drafts.md) into the
 * owner CRM. Pure parsing + validation; the admin action upserts the rows (dedupe on channel_id, then
 * on email / channel name). Every imported fact keeps its source URLs. Nothing is sent or approved.
 */
import { z } from "zod";

const str = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const SeedCreator = z.object({
  rank: z.coerce.number().int().min(1).max(1000).optional(),
  score: z.coerce.number().int().min(0).max(100).optional(),
  trade: z.string().trim().max(120).default("General"),
  channel: z.string().trim().min(1).max(200),
  creator: str(200),
  company: str(300),
  channel_url: str(500),
  channel_id: str(40),
  subscribers: z.union([z.string(), z.number()]).optional().transform((v) => (v == null ? null : String(v).slice(0, 40))),
  lifetime_views: z.union([z.number(), z.string()]).optional().transform((v) => { const n = Number(String(v ?? "").replace(/[^\d]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; }),
  website: str(500),
  published_business_email: str(320),
  contact_source_url: str(1000),
  email_status: str(1000),
  recommended_offer: str(500),
  personalization_angle: str(2000),
  verification_date: str(20),
  confidence: str(20),
  unresolved_gaps: str(2000),
  first_wave: z.union([z.string(), z.boolean()]).optional(),
}).passthrough();

const SeedWait = z.object({
  channel: z.string().trim().min(1).max(200),
  handle: str(100),
  subscribers: z.union([z.string(), z.number()]).optional().transform((v) => (v == null ? null : String(v).slice(0, 40))),
  trade: z.string().trim().max(120).default("General"),
  reason: str(1000),
  contact: str(500),
}).passthrough();

export const Seed = z.object({ generated: z.string().optional(), method: z.string().optional(), creators: z.array(SeedCreator).max(500), waitlist: z.array(SeedWait).max(500).default([]) });

export interface ProspectImport {
  channel_id: string | null; channel_name: string; handle: string | null; channel_url: string | null; creator_name: string | null;
  first_name: string | null; company: string | null; trade: string; rank: number | null; score: number | null;
  score_breakdown: Record<string, number> | null; subscribers_text: string | null; lifetime_views: number | null; website: string | null;
  contact_email: string | null; contact_source_url: string | null; contact_status: string | null; contact_verified_at: string | null;
  gift_tier: 5 | 10; personalization: string | null; research: Record<string, unknown>; sources: string[]; verification_date: string | null;
  confidence: "High" | "Medium" | "Low" | null; gaps: string | null; first_wave: boolean; waitlist: boolean;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const httpsOnly = (u: string | null) => (u && /^https:\/\/[^\s]+$/.test(u) ? u : null);

/** Every https URL mentioned anywhere in a research record (traceability). */
export function sourcesOf(record: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const v of Object.values(record)) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(/https:\/\/[^\s;|)"'<>,]+/g)) out.add(m[0].replace(/[.)]+$/, ""));
  }
  return [...out].slice(0, 40);
}

export function firstNameOf(creator: string | null): string | null {
  if (!creator) return null;
  const clean = creator.replace(/\(.*?\)/g, " ").split(/[,/&]| and /i)[0].trim();
  const first = clean.split(/\s+/)[0];
  return first && /^[A-Za-z][A-Za-z'-]{1,30}$/.test(first) && !/^(the|unknown|n\/a)$/i.test(first) ? first : null;
}

export function parseSeed(json: unknown): { prospects: ProspectImport[]; skipped: { channel: string; reason: string }[] } {
  const seed = Seed.parse(json);
  const prospects: ProspectImport[] = [];
  const skipped: { channel: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const c of seed.creators) {
    const raw = c as Record<string, unknown>;
    const id = c.channel_id && CHANNEL_ID.test(c.channel_id) ? c.channel_id : null;
    const key = id ?? c.channel.toLowerCase();
    if (seen.has(key)) { skipped.push({ channel: c.channel, reason: "duplicate" }); continue; }
    seen.add(key);
    const email = c.published_business_email && EMAIL.test(c.published_business_email) ? c.published_business_email.toLowerCase() : null;
    const breakdown: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (k.startsWith("score_") && typeof v === "number") breakdown[k.replace(/^score_/, "")] = v;
    const conf = (c.confidence ?? "").replace(/^(\w)(\w*).*$/, (_m, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
    prospects.push({
      channel_id: id, channel_name: c.channel, handle: c.channel_url?.match(/youtube\.com\/(@[\w.-]+)/)?.[1] ?? null,
      channel_url: httpsOnly(c.channel_url), creator_name: c.creator, first_name: firstNameOf(c.creator), company: c.company, trade: c.trade || "General",
      rank: c.rank ?? null, score: c.score ?? null, score_breakdown: Object.keys(breakdown).length ? breakdown : null,
      subscribers_text: c.subscribers, lifetime_views: c.lifetime_views, website: c.website,
      contact_email: email, contact_source_url: email ? httpsOnly(c.contact_source_url) : httpsOnly(c.contact_source_url),
      contact_status: c.email_status, contact_verified_at: email && c.verification_date && DATE.test(c.verification_date) ? c.verification_date : null,
      gift_tier: /\b10\b/.test(c.recommended_offer ?? "") ? 10 : 5, personalization: c.personalization_angle,
      research: raw, sources: sourcesOf(raw), verification_date: c.verification_date && DATE.test(c.verification_date) ? c.verification_date : null,
      confidence: (["High", "Medium", "Low"] as const).find((x) => x === conf) ?? null, gaps: c.unresolved_gaps,
      first_wave: c.first_wave === true || /^yes$/i.test(String(c.first_wave ?? "")), waitlist: false,
    });
  }
  for (const w of seed.waitlist) {
    if (seen.has(w.channel.toLowerCase())) continue;
    seen.add(w.channel.toLowerCase());
    const raw = w as Record<string, unknown>;
    prospects.push({
      channel_id: null, channel_name: w.channel, handle: w.handle, channel_url: w.handle ? `https://www.youtube.com/${w.handle}` : null,
      creator_name: null, first_name: null, company: null, trade: w.trade || "General", rank: null, score: null, score_breakdown: null,
      subscribers_text: w.subscribers, lifetime_views: null, website: w.contact, contact_email: null, contact_source_url: null,
      contact_status: w.reason ? `Waitlist: ${w.reason}` : "Waitlist", contact_verified_at: null, gift_tier: 5, personalization: null,
      research: raw, sources: sourcesOf(raw), verification_date: seed.generated && DATE.test(seed.generated) ? seed.generated : null,
      confidence: null, gaps: "Waitlist entry: verify contact and recent activity before outreach.", first_wave: false, waitlist: true,
    });
  }
  return { prospects, skipped };
}

export interface DraftImport { rank: number; subject: string; body: string }

/** "## N. Channel ... \n **To:** ... · **Subject:** ...\n\n body \n---" sections of outreach_drafts.md. */
export function parseDrafts(md: string): DraftImport[] {
  const out: DraftImport[] = [];
  const sections = md.replace(/\r/g, "").split(/\n(?=## \d+\.)/);
  for (const s of sections) {
    const head = s.match(/^## (\d+)\./);
    const subj = s.match(/\*\*Subject:\*\*\s*(.+)\n/);
    if (!head || !subj) continue;
    const afterMeta = s.slice(s.indexOf(subj[0]) + subj[0].length);
    const body = afterMeta.split(/\n---\s*(\n|$)|\n# /)[0].trim();
    if (body.length < 20) continue;
    out.push({ rank: Number(head[1]), subject: subj[1].trim().slice(0, 200), body: body.slice(0, 6000) });
  }
  return out;
}
