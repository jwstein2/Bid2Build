import { Notice } from "@/components/ui/misc";

/** ?msg= / ?err= banners set by owner server actions. Rendered as plain text (never HTML). */
export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (err) return <Notice tone="danger">{err.slice(0, 600)}</Notice>;
  if (msg) return <Notice tone="ok"><span className="break-all">{msg.slice(0, 800)}</span></Notice>;
  return null;
}

export const fmtDate = (s: string | null | undefined, withTime = false) =>
  s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : {}) }) : "—";

export const input = "w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm";
export const btn = "min-h-10 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";
export const btnSecondary = "min-h-10 rounded-md border border-line-strong px-3 py-2 text-sm font-semibold";
