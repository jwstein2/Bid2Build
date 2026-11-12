import Link from "next/link";
import { site } from "@/lib/site";
import { cn } from "@/lib/cn";

const RULER = "M10 14.8H18.6V52H10Z";
const BOWLS =
  "M19.5 11H40C47.2 11 52 15.2 52 21.2C52 24.6 50.2 27.4 47.4 28.9C50.8 30.6 52.4 33.6 52.4 37.6C52.4 45.6 47.5 52 40 52H18.6L27.1 43.5H38A3.5 3.5 0 0 0 38 36.5H19.5V28H36.5A4 4 0 0 0 36.5 20H19.5Z";
const TICKS = Array.from({ length: 10 }, (_, i) => `M10 ${(18 + i * 3.3).toFixed(1)}h${i % 2 === 0 ? 4.6 : 3.2}`).join("");
const CONSTRUCTION = "M19.5 16.8H36L47.4 28.2M44.6 29.6L39.6 35";
const CHECK = "M31.4 45.8L38.8 53L55.8 34.8";

/**
 * Built2Bid mark, per the approved Blueprint Precision board: a solid B whose stem is a ruler,
 * drafting lines cut through the bowls, a 45-degree chamfer, and a teal check closing the bowl.
 * Master artwork and generator: public/brand/*.svg, scripts/brand/generate_svgs.py.
 * `detail={false}` drops ticks and construction lines for sizes below 24px.
 */
export function LogoMark({ className = "h-8 w-8", tone = "light", detail = true }: { className?: string; tone?: "light" | "dark"; detail?: boolean }) {
  const id = `b2b-cut-${tone}-${detail ? 1 : 0}`;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        <rect width="64" height="64" fill="#fff" />
        <path d={CHECK} fill="none" stroke="#000" strokeWidth="8.6" strokeLinecap="square" />
        {detail && <path d={TICKS} stroke="#000" strokeWidth="0.95" />}
        {detail && <path d={CONSTRUCTION} fill="none" stroke="#000" strokeWidth="0.9" />}
      </mask>
      <g fill={tone === "dark" ? "#FFFFFF" : "#0B2D4D"} mask={`url(#${id})`}>
        <path d={RULER} />
        <path d={BOWLS} />
      </g>
      <path d={CHECK} fill="none" stroke="#14B8A6" strokeWidth="5" />
    </svg>
  );
}

/** Wordmark with the numeral emphasised. On light: navy + deep cyan. On dark: white + brand cyan. */
export function Wordmark({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const name = site.name;
  const i = name.indexOf("2");
  // Numeral in the board's cyan gradient (deep cyan to brand cyan); solid fallback colour first.
  const two = tone === "dark"
    ? "text-cyan bg-gradient-to-tr from-[#00C2E0] to-[#33D1EA] bg-clip-text [-webkit-text-fill-color:transparent]"
    : "text-[#0097B2] bg-gradient-to-tr from-[#0097B2] to-[#00C2E0] bg-clip-text [-webkit-text-fill-color:transparent]";
  const main = tone === "dark" ? "text-white" : "text-navy";
  if (i < 0) return <span className={cn(main, className)}>{name}</span>;
  return (
    <span className={cn(main, className)}>
      {name.slice(0, i)}<span className={two}>2</span>{name.slice(i + 1)}
    </span>
  );
}

export function Logo({ className = "", tone = "light", href = "/" }: { className?: string; tone?: "light" | "dark"; href?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 font-display text-lg font-extrabold tracking-tight", className)} aria-label={`${site.name} home`}>
      <LogoMark className="h-9 w-9 shrink-0" tone={tone} />
      <Wordmark tone={tone} />
    </Link>
  );
}
