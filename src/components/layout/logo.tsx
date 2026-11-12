import Link from "next/link";
import { site } from "@/lib/site";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2 font-display text-lg font-extrabold tracking-tight text-ink ${className}`} aria-label={`${site.name} home`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="7" fill="var(--color-brand)" />
        <path d="M8 22V12l8-5 8 5v10" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M12.5 22v-5.5h7V22" fill="none" stroke="var(--color-accent)" strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
      <span>{site.name}</span>
    </Link>
  );
}
