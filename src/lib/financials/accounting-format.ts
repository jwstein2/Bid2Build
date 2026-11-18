/** Date display shared by server pages (fin-client's fmtDate lives in a client module). */
export function fmtDateServer(d: unknown): string {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split("-").map(Number);
  if (!y || !m || !day) return s;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
/** "Nov 18, 2026, 3:04 PM UTC" for timestamps. */
export function fmtWhen(ts: unknown): string {
  if (!ts) return "—";
  const d = new Date(String(ts));
  if (Number.isNaN(d.getTime())) return String(ts);
  return `${d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`;
}
