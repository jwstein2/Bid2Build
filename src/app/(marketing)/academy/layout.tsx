import Link from "next/link";
import { after } from "next/server";
import { GraduationCap } from "lucide-react";
import { AcademyTabs } from "@/components/academy/academy-tabs";
import { Container } from "@/components/ui/misc";
import { loadMe, touchPresence } from "@/lib/academy/server";

export default async function AcademyLayout({ children }: { children: React.ReactNode }) {
  const { me } = await loadMe();
  // Presence: one throttled write per minute, after the response is sent.
  if (me.member) after(() => touchPresence().catch(() => {}));
  const secondary = [
    ...(me.member ? [{ href: "/academy/saved", label: "Saved" }, { href: "/academy/settings", label: "My profile" }] : []),
    { href: "/academy/about", label: "About" },
    ...(me.role && ["admin", "moderator", "instructor"].includes(me.role) ? [{ href: "/academy/manage", label: "Manage" }] : []),
  ];
  return (
    <div className="bg-paper">
      <div className="border-b border-line bg-surface">
        <Container className="pt-4 pb-3">
          <Link href="/academy" className="inline-flex items-center gap-2 font-display text-lg font-extrabold text-ink">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-cyan" aria-hidden><GraduationCap className="h-4 w-4" /></span>
            Contractor Academy
          </Link>
          <div className="mt-3"><AcademyTabs secondary={secondary} /></div>
        </Container>
      </div>
      {children}
    </div>
  );
}
