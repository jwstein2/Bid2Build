/** Sales CRM shapes and labels shared by the rep portal and the owner Sales Hub. */
export const STAGES = ["new", "contacted", "engaged", "demo", "trial", "paying", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { new: "New lead", contacted: "Contacted", engaged: "Engaged", demo: "Demo", trial: "Trial / free account", paying: "Paying", lost: "Lost" };
export const ACTIVITY_LABEL: Record<string, string> = { call: "Call", email: "Email", text: "Text", meeting: "Meeting", note: "Note", stage: "Stage change", assignment: "Assignment", system: "System" };
export const SOURCE_LABEL: Record<string, string> = { manual: "Added by rep", import: "Imported", places: "Places search", link: "Rep link", owner: "Added by owner", agent: "Weekly import" };
export const TRADES = ["general contracting", "roofing", "siding", "decks", "painting", "concrete", "electrical", "plumbing", "hvac", "drywall", "fencing", "landscaping", "remodeling", "windows", "gutters", "flooring"] as const;

export interface Lead {
  id: string; company_name: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null;
  city: string | null; state: string | null; zip: string | null; trades: string[]; source: string; source_ref: string | null; discovered_at: string;
  stage: Stage; lost_reason: string | null; assigned_rep: string | null; rep_name: string | null; customer_user_id: string | null; customer_tier: string | null;
  do_not_contact: boolean; next_action_at: string | null; last_activity_at: string | null; notes: string | null; open_tasks: number; created_at: string; updated_at: string;
  /** Weekly import only: business start date as published, where each fact was checked, Haiku sales brief. */
  business_started?: string | null; verification?: Record<string, unknown> | null; sales_brief?: string | null;
}

/** Labels for the verification sources the weekly import records. */
export const VERIFIED_LABEL: Record<string, string> = { owner_name: "Owner", email: "Email", phone: "Phone", business_started: "Start date" };
export function verificationSources(v: Lead["verification"]): { field: string; urls: string[] }[] {
  if (!v) return [];
  return Object.entries(VERIFIED_LABEL).flatMap(([k, label]) => {
    const urls = Array.isArray(v[k]) ? (v[k] as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)) : [];
    return urls.length ? [{ field: label, urls }] : [];
  });
}
export interface LeadTask { id: string; lead_id?: string; company_name?: string; title: string; due_at: string; done_at?: string | null }
export interface LeadActivity { id: number; kind: string; body: string | null; occurred_at: string; rep_name: string | null }
export interface Duplicate { id: string; company_name: string; zip: string | null; rep_name: string | null; stage: string }

/** Parse pasted rows: one business per line, comma or tab separated, in COLUMNS order. A header row is skipped. */
export const IMPORT_COLUMNS = ["company_name", "contact_name", "email", "phone", "website", "city", "state", "zip", "trades"] as const;
export function parseLeadRows(text: string, max = 500): Record<string, string | string[]>[] {
  const rows: Record<string, string | string[]>[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = (line.includes("\t") ? line.split("\t") : splitCsv(line)).map((c) => c.trim());
    if (/^company/i.test(cells[0] ?? "")) continue;
    const r: Record<string, string | string[]> = {};
    IMPORT_COLUMNS.forEach((k, i) => { if (cells[i]) r[k] = k === "trades" ? cells[i].split(/[;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean) : cells[i]; });
    if (r.company_name) rows.push(r);
    if (rows.length >= max) break;
  }
  return rows;
}
function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
