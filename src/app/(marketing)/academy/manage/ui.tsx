import Link from "next/link";

export const field = "mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-normal";
export const label = "text-sm font-semibold";

export function MetricTile({ label: l, value, href, tone }: { label: string; value: number; href: string; tone?: "warn" }) {
  return (
    <Link href={href} className={`block rounded-xl border bg-surface p-4 shadow-card hover:border-line-strong ${tone === "warn" ? "border-warn/50" : "border-line"}`}>
      <span className="block text-xs font-semibold text-muted">{l}</span>
      <span className="mt-1 block font-display text-2xl font-extrabold">{value.toLocaleString("en-US")}</span>
    </Link>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = { published: "bg-ok-tint text-ok", verified: "bg-ok-tint text-ok", active: "bg-ok-tint text-ok", in_review: "bg-warn-tint text-warn", candidate: "bg-warn-tint text-warn", open: "bg-warn-tint text-warn" };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone[status] ?? "bg-black/5 text-ink-soft"}`}>{status.replace("_", " ")}</span>;
}
