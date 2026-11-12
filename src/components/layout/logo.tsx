import Link from "next/link";
import { site } from "@/lib/site";
import { cn } from "@/lib/cn";

/**
 * Built2Bid mark: a drafted uppercase B (ruler ticks + constant strokes) closed by a teal check.
 * Master artwork and generator: public/brand/*.svg, scripts/brand/generate_svgs.py.
 * `ticks={false}` drops the ruler scale for sizes below 24px.
 */
export function LogoMark({ className = "h-8 w-8", ticks = true }: { className?: string; ticks?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <rect width="64" height="64" rx="14" fill="#0B2D4D" />
      {ticks && <path d="M10 16h4M10 22h2.5M10 28h2.5M10 34h4M10 40h2.5M10 46h2.5" stroke="#00C2E0" strokeWidth="1.8" strokeLinecap="round" />}
      <g fill="none" stroke="#fff" strokeWidth="5.5" strokeLinejoin="round">
        <path d="M19 13V51" />
        <path d="M19 15.75H32a7.5 7.5 0 0 1 0 15H19" />
        <path d="M19 30.75H34a8.75 8.75 0 0 1 8.75 8.75" />
        <path d="M19 48.25H31" />
      </g>
      <path d="M32 45.5l5.5 5.5L52.5 36" fill="none" stroke="#0B2D4D" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 45.5l5.5 5.5L52.5 36" fill="none" stroke="#14B8A6" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Wordmark with the numeral emphasised. On light: navy + deep cyan. On dark: white + brand cyan. */
export function Wordmark({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const name = site.name;
  const i = name.indexOf("2");
  const two = tone === "dark" ? "text-cyan" : "text-[#0097B2]";
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
      <LogoMark className="h-8 w-8 shrink-0" />
      <Wordmark tone={tone} />
    </Link>
  );
}
