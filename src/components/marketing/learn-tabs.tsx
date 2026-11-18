import Link from "next/link";
import { cn } from "@/lib/cn";

export const LEARN_LINKS = [
  { href: "/learn", label: "Guides", description: "Pricing and estimating guides" },
  { href: "/tools", label: "Calculators", description: "Free concrete, deck, roofing and markup calculators" },
  { href: "/academy", label: "Academy", description: "Free courses and a contractor community" },
] as const;

/** The three parts of Learn, shown at the top of the Guides and Calculators pages. */
export function LearnTabs({ current }: { current: "/learn" | "/tools" }) {
  return (
    <nav aria-label="Learn" className="mb-6 flex gap-1 overflow-x-auto border-b border-line" data-testid="learn-tabs">
      {LEARN_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.href === current ? "page" : undefined}
          className={cn("-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold", l.href === current ? "border-accent-dark text-navy" : "border-transparent text-ink-soft hover:text-navy")}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
