import Link from "next/link";
import { Building2, Clock, FileCheck2, HardHat, Users } from "lucide-react";

const TABS = [
  { key: "people", href: "/projects/team", label: "People & subs", Icon: Users },
  { key: "time", href: "/projects/team/time", label: "Employees & time", Icon: Clock },
  { key: "suppliers", href: "/projects/team/suppliers", label: "Suppliers", Icon: Building2 },
  { key: "subs", href: "/projects/team/subs", label: "Sub records", Icon: HardHat },
  { key: "1099", href: "/projects/team/1099", label: "1099 totals", Icon: FileCheck2 },
] as const;
export type TeamTab = (typeof TABS)[number]["key"];

/** Sections of Team & Subcontractors. Scrolls sideways on small phones instead of wrapping. */
export function TeamNav({ active }: { active: TeamTab }) {
  return (
    <nav aria-label="Team sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="team-nav">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {TABS.map(({ key, href, label, Icon }) => (
          <li key={key}>
            <Link href={href} aria-current={active === key ? "page" : undefined}
              className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold ${active === key ? "border-accent-ink text-navy" : "border-transparent text-ink-soft hover:text-navy"}`}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Page header shared by every Team section. */
export function TeamHeader({ title, intro }: { title: string; intro: string }) {
  return (
    <div>
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline">‹ Projects</Link>
      <h1 className="mt-1 text-3xl font-extrabold text-navy">{title}</h1>
      <p className="mt-1 text-ink-soft">{intro}</p>
    </div>
  );
}
