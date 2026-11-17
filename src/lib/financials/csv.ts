/**
 * CSV cell for exports opened in Excel / Sheets. Quotes every cell and neutralizes spreadsheet formula
 * injection: text starting with = + - @ tab or CR gets a leading apostrophe. Plain numbers (including
 * negatives like -12.50) are left as numbers.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}
