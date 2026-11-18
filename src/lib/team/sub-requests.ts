/**
 * Subcontractor self-serve requests (W-9 + insurance/license uploads) and 1099-NEC exports. Pure helpers shared
 * by the routes, the public /sub-docs page and tests.
 */
export const SUB_REQUEST_KINDS = ["w9", "coi_general_liability", "workers_comp", "auto_liability", "umbrella", "license"] as const;
export type SubRequestKind = (typeof SUB_REQUEST_KINDS)[number];

export const REQUEST_LABEL: Record<SubRequestKind, string> = {
  w9: "W-9 (filled in online)", coi_general_liability: "General liability certificate", workers_comp: "Workers' comp certificate",
  auto_liability: "Auto liability certificate", umbrella: "Umbrella / excess certificate", license: "Contractor license",
};

export function subRequestEmail(o: { companyName: string; subName: string; kinds: readonly SubRequestKind[]; note: string | null; link: string }): { subject: string; text: string } {
  const first = o.subName.trim().split(/\s+/)[0] || "there";
  const list = o.kinds.map((k) => `  - ${REQUEST_LABEL[k]}`).join("\n");
  return {
    subject: `${o.companyName}: please send your ${o.kinds.includes("w9") ? "W-9" : "insurance"} paperwork`,
    text: `Hi ${first},\n\n${o.companyName} needs the following from you before your next payment:\n${list}\n\n`
      + (o.note ? `${o.note}\n\n` : "")
      + `You can fill it in and upload files here (the link works once and expires in 14 days):\n${o.link}\n\n`
      + `Your tax ID is encrypted and only shared with ${o.companyName}.\n\nThank you,\n${o.companyName}`,
  };
}

/** Days from today until a date (negative = past). */
export function daysUntil(day: string, today: string): number {
  return Math.round((Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000);
}

export interface ExpiryItem { subName: string; docType: string; expiresOn: string; stage: "30_days" | "7_days" | "expired" }

const DOC_LABEL: Record<string, string> = { ...REQUEST_LABEL, w9: "W-9" };

export function complianceDigest(o: { companyName: string; items: ExpiryItem[]; link: string; today: string }): { subject: string; text: string } {
  const expired = o.items.filter((i) => i.stage === "expired");
  const soon = o.items.filter((i) => i.stage !== "expired");
  const line = (i: ExpiryItem) => {
    const d = daysUntil(i.expiresOn, o.today);
    return `  - ${i.subName}: ${DOC_LABEL[i.docType] ?? i.docType} ${d < 0 ? `expired ${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "expires today" : `expires in ${d} day${d === 1 ? "" : "s"}`} (${i.expiresOn})`;
  };
  const subject = expired.length
    ? `${expired.length} subcontractor certificate${expired.length === 1 ? " has" : "s have"} expired`
    : `${soon.length} subcontractor certificate${soon.length === 1 ? "" : "s"} expiring soon`;
  return {
    subject,
    text: `Hi,\n\nHere's what needs attention for ${o.companyName}:\n\n`
      + (expired.length ? `Expired:\n${expired.map(line).join("\n")}\n\n` : "")
      + (soon.length ? `Expiring soon:\n${soon.map(line).join("\n")}\n\n` : "")
      + `Ask each sub for a new certificate from their page (Request documents sends them a secure upload link):\n${o.link}\n\n`
      + `Built2Bid records what's on file; it doesn't check coverage with the insurer.\n\nBuilt2Bid`,
  };
}

/** CSV-safe cell (quotes, commas, newlines; leading =+-@ neutralized so spreadsheets don't run formulas). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface Nec1099Row {
  recipientName: string; businessName: string | null; tinType: "ssn" | "ein" | null; tin: string | null; address: string | null; amount: string;
}
export interface Payer { legalName: string; ein: string | null; address: string | null; phone: string | null }

export const NEC_CSV_HEADERS = [
  "Tax Year", "Form", "Payer Name", "Payer TIN", "Payer Address", "Payer Phone",
  "Recipient TIN Type", "Recipient TIN", "Recipient Name", "Recipient Second Name", "Recipient Address",
  "Box 1 Nonemployee Compensation", "Box 4 Federal Income Tax Withheld",
] as const;

/** One row per subcontractor that needs a 1099-NEC. Map these columns to your e-file service or the IRS IRIS template. */
export function necCsv(year: number, payer: Payer, rows: Nec1099Row[]): string {
  const lines = [NEC_CSV_HEADERS.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([year, "1099-NEC", payer.legalName, payer.ein ?? "", payer.address ?? "", payer.phone ?? "",
      r.tinType === "ssn" ? "SSN" : r.tinType === "ein" ? "EIN" : "", r.tin ?? "", r.recipientName, r.businessName ?? "", r.address ?? "",
      Number(r.amount).toFixed(2), "0.00"].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
