import Link from "next/link";

const LINKS = [
  { href: "/admin/creators", label: "Creators & outreach" },
  { href: "/admin/creators/programs", label: "Learning Team grants" },
  { href: "/admin/creators/settings", label: "Outreach settings" },
] as const;

export function CreatorSubNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav aria-label="Creator Partnerships" className="flex flex-wrap gap-1 border-b border-line pb-2 text-sm">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined}
          className={l.href === current ? "rounded-md bg-navy px-3 py-1.5 font-semibold text-white" : "rounded-md px-3 py-1.5 font-medium text-ink-soft hover:bg-black/5"}>{l.label}</Link>
      ))}
    </nav>
  );
}
