import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { AcademyTabs } from "@/components/academy/academy-tabs";
import { AcademyPresence } from "@/components/academy/presence";
import { Container } from "@/components/ui/misc";
import { loadMe } from "@/lib/academy/server";

export default async function AcademyLayout({ children }: { children: React.ReactNode }) {
  const { me } = await loadMe();
  // Presence runs in the browser (AcademyPresence): a heartbeat while the member is active, live stats for everyone.
  // It used to be an after() callback here, but cookies() can't be read inside after() in a Server Component, so the
  // write always failed silently and last_seen_at was never set.
  const secondary = [
    ...(me.member ? [{ href: "/academy/saved", label: "Saved" }, { href: "/academy/settings", label: "My profile" }] : []),
    { href: "/academy/about", label: "About" },
    ...(me.role && ["admin", "moderator", "instructor"].includes(me.role) ? [{ href: "/academy/manage", label: "Manage" }] : []),
  ];
  return (
    <div className="bg-paper">
      <AcademyPresence member={Boolean(me.member)} />
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
