"use client";

import type { AcademyStats } from "@/lib/academy/server";
import { useAcademyStats } from "./presence";

const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

/** The community statistics row. Same markup as before; the numbers now update live (see presence.tsx). */
export function AcademyLiveStats({ initial }: { initial: AcademyStats | null }) {
  const stats = useAcademyStats(initial);
  if (!stats) return <p className="mt-4 border-y border-line py-3 text-xs text-muted">Member counts appear once the community is live.</p>;
  return (
    <>
      <dl className="mt-4 grid grid-cols-4 gap-1 border-y border-line py-3 text-center" data-testid="academy-stats" aria-live="polite">
        <div><dd className="font-display text-lg font-extrabold" data-stat="members">{n(stats.members)}</dd><dt className="text-[11px] text-muted">Members</dt></div>
        <div><dd className="flex items-center justify-center gap-1 font-display text-lg font-extrabold" data-stat="online"><span className="h-2 w-2 rounded-full bg-ok" aria-hidden />{n(stats.online)}</dd><dt className="text-[11px] text-muted">Online</dt></div>
        <div><dd className="font-display text-lg font-extrabold" data-stat="admins">{n(stats.admins)}</dd><dt className="text-[11px] text-muted">Admins</dt></div>
        <div><dd className="font-display text-lg font-extrabold" data-stat="moderators">{n(stats.moderators)}</dd><dt className="text-[11px] text-muted">Moderators</dt></div>
      </dl>
      <p className="mt-2 text-[11px] text-muted">Online means active in the Academy in the last {stats.online_window_minutes} minutes. Counts include only people who joined the Academy.</p>
    </>
  );
}
