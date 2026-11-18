import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { levelName } from "@/lib/academy/types";
import { academyDb, loadMe, loadStats } from "@/lib/academy/server";

const FALLBACK = {
  name: "Built2Bid Contractor Academy",
  tagline: "Learn the business. Run the business. Grow the business.",
  description: "A professional community for contractors to learn selling, estimating, project management, hiring and financials, organized by trade.",
  rules: [] as string[],
};

export async function loadSettings() {
  const db = await academyDb();
  if (!db) return FALLBACK;
  const { data } = await db.from("academy_settings").select("name, tagline, description, rules").maybeSingle();
  return (data as typeof FALLBACK | null) ?? FALLBACK;
}

const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

/** Community sidebar: identity, real member statistics, rules, membership status and starting links. */
export async function AcademySidebar() {
  const [{ me, migrated }, stats, settings] = await Promise.all([loadMe(), loadStats(), loadSettings()]);
  return (
    <aside className="grid content-start gap-4" aria-label="About the Academy" data-testid="academy-sidebar">
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="relative h-24 bg-navy" aria-hidden>
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(135deg,transparent_0_46%,var(--color-cyan)_46%_48%,transparent_48%_100%)] [background-size:22px_22px]" />
          <span className="absolute bottom-3 left-4 grid h-10 w-10 place-items-center rounded-lg bg-cyan text-navy"><GraduationCap className="h-5 w-5" /></span>
        </div>
        <div className="p-4">
          <h2 className="font-display text-lg font-extrabold">{settings.name}</h2>
          <p className="mt-0.5 text-xs font-semibold text-accent-ink">{settings.tagline}</p>
          <p className="mt-2 text-sm text-ink-soft">{settings.description}</p>
          {stats ? (
            <dl className="mt-4 grid grid-cols-4 gap-1 border-y border-line py-3 text-center" data-testid="academy-stats">
              <div><dd className="font-display text-lg font-extrabold" data-stat="members">{n(stats.members)}</dd><dt className="text-[11px] text-muted">Members</dt></div>
              <div><dd className="flex items-center justify-center gap-1 font-display text-lg font-extrabold" data-stat="online"><span className="h-2 w-2 rounded-full bg-ok" aria-hidden />{n(stats.online)}</dd><dt className="text-[11px] text-muted">Online</dt></div>
              <div><dd className="font-display text-lg font-extrabold" data-stat="admins">{n(stats.admins)}</dd><dt className="text-[11px] text-muted">Admins</dt></div>
              <div><dd className="font-display text-lg font-extrabold" data-stat="moderators">{n(stats.moderators)}</dd><dt className="text-[11px] text-muted">Moderators</dt></div>
            </dl>
          ) : (
            <p className="mt-4 border-y border-line py-3 text-xs text-muted">Member counts appear once the community is live.</p>
          )}
          {stats && <p className="mt-2 text-[11px] text-muted">Online means active in the Academy in the last {stats.online_window_minutes} minutes. Counts include only people who joined the Academy.</p>}
          <div className="mt-4">
            {!migrated ? (
              <p className="rounded-lg bg-brand-tint px-3 py-2 text-sm text-navy">The community is being set up. The Classroom is open now.</p>
            ) : !me.signed_in ? (
              <Link href="/login?next=/academy/join" className={buttonClass("accent", "md", "w-full")}>Join free with your Built2Bid account</Link>
            ) : me.member ? (
              <div className="rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok" data-testid="membership-status">
                <b>You&apos;re a member</b>{me.role && me.role !== "member" ? ` · ${me.role}` : ""}{me.premium ? " · Premium" : ""}
                <span className="block text-xs">Level {me.level ?? 1}: {levelName(me.level ?? 1)} · {n(me.points)} points</span>
                {me.status === "suspended" && <span className="mt-1 block text-xs text-warn">Posting is paused on your account{me.suspended_until ? ` until ${new Date(me.suspended_until).toLocaleDateString("en-US")}` : ""}.</span>}
              </div>
            ) : me.status === "banned" ? (
              <p className="text-sm text-ink-soft">This account can&apos;t take part in the Academy community.</p>
            ) : (
              <Link href="/academy/join" className={buttonClass("accent", "md", "w-full")} data-cta="academy-join">Join the community (free)</Link>
            )}
          </div>
        </div>
      </section>
      {settings.rules.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-sm font-bold">Community rules</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-ink-soft">{settings.rules.map((r) => <li key={r}>{r}</li>)}</ol>
        </section>
      )}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold">Start here</h2>
        <ul className="mt-2 space-y-1.5 text-sm">
          <li><Link className="font-semibold text-accent-ink hover:underline" href="/academy/courses/contractor-sales-academy">Contractor Sales Academy (free)</Link></li>
          <li><Link className="font-semibold text-accent-ink hover:underline" href={me.primary_trade ? `/academy/classroom/${me.primary_trade}` : "/academy/classroom"}>{me.primary_trade ? "Your trade classroom" : "Find your trade classroom"}</Link></li>
          <li><Link className="font-semibold text-accent-ink hover:underline" href="/academy/about">How the Academy works</Link></li>
        </ul>
      </section>
    </aside>
  );
}
