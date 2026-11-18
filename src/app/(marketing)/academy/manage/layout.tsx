import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/misc";
import { requireAcademyStaff } from "@/lib/academy/server";

export const metadata: Metadata = { title: "Manage Academy", robots: { index: false, follow: false } };

export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAcademyStaff(["admin", "moderator", "instructor"]);
  if (!s) notFound();
  const role = s.me.role!;
  const links = [
    { href: "/academy/manage", label: "Overview", roles: ["admin", "moderator", "instructor"] },
    { href: "/academy/manage/courses", label: "Courses", roles: ["admin", "instructor"] },
    { href: "/academy/manage/resources", label: "Resources", roles: ["admin", "instructor"] },
    { href: "/academy/manage/licenses", label: "Creator licences", roles: ["admin"] },
    { href: "/academy/manage/reports", label: "Reports", roles: ["admin", "moderator"] },
    { href: "/academy/manage/members", label: "Members", roles: ["admin", "moderator"] },
    { href: "/academy/manage/settings", label: "Settings", roles: ["admin"] },
    { href: "/academy/manage/audit", label: "Audit log", roles: ["admin"] },
  ].filter((l) => l.roles.includes(role));
  return (
    <Container className="py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-extrabold">Manage Academy</h1>
        <p className="text-xs text-muted">Signed in as Academy {role}{s.me.platform_admin ? " (platform admin)" : ""}</p>
      </div>
      <nav aria-label="Manage sections" className="mt-3 flex gap-1 overflow-x-auto border-b border-line pb-2">
        {links.map((l) => <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-surface hover:text-ink">{l.label}</Link>)}
      </nav>
      <div className="mt-5">{children}</div>
    </Container>
  );
}
