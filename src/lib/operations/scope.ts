/** Trade scope workspace (V4.3): which section fields can be shared with a subcontractor. */
export const SHAREABLE_FIELDS = [
  { key: "approvedScope", label: "Approved scope (from the proposal)" },
  { key: "workDescription", label: "Work description" },
  { key: "technicalInstructions", label: "Technical instructions" },
  { key: "installationNotes", label: "Installation notes" },
  { key: "customerInfo", label: "Customer-facing notes" },
  { key: "siteAddress", label: "Job site address" },
  { key: "schedule", label: "Scheduled dates for this section" },
] as const;
export type ShareField = (typeof SHAREABLE_FIELDS)[number]["key"];
export const DEFAULT_SHARE_FIELDS: ShareField[] = ["workDescription", "technicalInstructions", "installationNotes"];

export interface ScopeSection {
  id: string; estimate_id: string; source_group_id: string; trade: string | null; title: string; sort_order: number;
  approved_scope: string | null; work_description: string | null; technical_instructions: string | null; installation_notes: string | null;
  internal_notes: string | null; customer_info: string | null; resource_id: string | null; revision: number; updated_at: string; updated_by: string | null;
}

/** The frozen share content: only the selected fields (internal notes can never be shared). */
export function shareContent(s: ScopeSection, fields: ShareField[], ctx: { projectTitle: string; siteAddress?: string | null; dates?: { start: string; end: string } | null; company: string; assignee?: string | null }) {
  const pick = new Set(fields);
  const f: Record<string, string> = {};
  if (pick.has("approvedScope") && s.approved_scope) f.approvedScope = s.approved_scope;
  if (pick.has("workDescription") && s.work_description) f.workDescription = s.work_description;
  if (pick.has("technicalInstructions") && s.technical_instructions) f.technicalInstructions = s.technical_instructions;
  if (pick.has("installationNotes") && s.installation_notes) f.installationNotes = s.installation_notes;
  if (pick.has("customerInfo") && s.customer_info) f.customerInfo = s.customer_info;
  if (pick.has("siteAddress") && ctx.siteAddress) f.siteAddress = ctx.siteAddress;
  if (pick.has("schedule") && ctx.dates) f.schedule = `${ctx.dates.start} to ${ctx.dates.end}`;
  return { title: s.title, trade: s.trade, project: ctx.projectTitle, company: ctx.company, assignee: ctx.assignee ?? null, fields: f };
}
