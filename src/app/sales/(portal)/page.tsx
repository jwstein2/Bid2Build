import Link from "next/link";
import { AttentionCard, type Attention } from "./leads/attention";
import { Card, Notice } from "@/components/ui/misc";
import { ShareLink } from "@/components/sales/share-link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadSalesAccess, requireSalesRep } from "@/lib/sales/server";
import { landingView, VIEW_COOKIE } from "@/lib/sales/caps";
import { repLink } from "@/lib/sales/link";
import { qrFor } from "@/lib/sales/qr";
import { projectedCommissions } from "@/lib/sales/basis";
import { currentMonthChicago, monthLabel, usd } from "@/lib/sales/format";
import type { RepOverview } from "@/lib/sales/types";
import { DEFAULT_MILESTONES, nextMilestone, teamGoal, type GoalRaw, type MilestoneRules } from "@/lib/sales/goals";
import { quests, type Progress } from "@/lib/sales/quests";
import { personalBests, type MonthCounts } from "@/lib/sales/incentives";
import { AcceleratorCard, PersonalBestsCard, type MyAccelerator } from "@/components/sales/incentive-cards";
import { TeamGoalBoard } from "@/components/sales/team-goal-board";
import { QuestCard } from "@/components/sales/quest-card";
import { MilestoneBoxes, type MilestoneAward } from "@/components/sales/gift-box";
import { CompensationCard, type Compensation } from "@/components/sales/compensation-card";
import { TeamWins } from "@/components/sales/team-wins";
import { CustomerSuccessCard, SuccessCelebration, type Success } from "@/components/sales/success-celebration";
import { recommendedLayout, sectionOrder, type Answers, type Layout } from "@/lib/sales/preferences";

export const metadata = { title: "Overview" };

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export default async function SalesOverview({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const welcome = (await searchParams).welcome === "1";
  // /sales opens the hub the person used last (or the only one they have).
  const access = await loadSalesAccess();
  if (access.kind === "staff" && landingView(access.caps, (await cookies()).get(VIEW_COOKIE)?.value) === "admin") redirect("/sales/admin");
  const { db } = await requireSalesRep();
  const [{ data, error }, goalRes, msRes, progRes, accRes, recRes, prefRes, sucRes] = await Promise.all([
    db.rpc("sales_my_overview"), db.rpc("sales_my_team_goal"), db.rpc("sales_my_milestones"), db.rpc("sales_my_progress", {}),
    db.rpc("sales_my_accelerator", {}), db.rpc("sales_my_records", {}), db.rpc("sales_my_preferences"), db.rpc("sales_my_successes"),
  ]);
  // Compensation V3 dashboard (hidden until 20270202001000 is applied).
  const compRes = await db.rpc("sales_my_compensation");
  const comp = compRes.error || !compRes.data ? null : (compRes.data as Compensation);
  // V8.7 lead recycling (hidden until 20270122001000 is applied).
  const attRes = await db.rpc("sales_my_attention");
  const attention = attRes.error || !attRes.data ? null : (attRes.data as Attention);
  // V8.4 P3 (hidden until 20270119001000 is applied).
  const winsRes = await db.rpc("sales_team_wins", {});
  const wins = winsRes.error || !winsRes.data ? null : (winsRes.data as { rep: string; kind: string; at: string; mine: boolean }[]);
  // V8.4 P1 (hidden until 20270117001000 is applied): layout order and customer success celebrations.
  const prefs = prefRes.error || !prefRes.data ? null : (prefRes.data as { status: string; answers: Answers; dashboard_layout: Layout | null; animations: boolean });
  const successes = sucRes.error || !sucRes.data ? null : (sucRes.data as Success[]);
  const layout: Layout = prefs?.dashboard_layout ?? (prefs ? recommendedLayout(prefs.answers ?? {}) : "progress");
  // V8.4 (hidden until 20270116001000 is applied; the accelerator card shows once the owner turns it on).
  const acc = accRes.error || !accRes.data ? null : (accRes.data as MyAccelerator);
  const rec = recRes.error || !recRes.data ? null : (recRes.data as { months: MonthCounts[]; achievements: { kind: string; month: string; value: number | null; detail: Record<string, unknown> | null }[] });
  const bests = rec ? personalBests(rec.months) : null;
  // V8 boards appear once 20270111001000 is applied.
  const goal = goalRes.error || !goalRes.data ? null : teamGoal(goalRes.data as GoalRaw);
  const ms = msRes.error || !msRes.data ? null : (msRes.data as { accounts: number; every: number; rates: MilestoneRules["rates"]; min_cents: number; flat: MilestoneRules["flat"]; awards: MilestoneAward[] });
  const rules: MilestoneRules = ms ? { every: ms.every, rates: ms.rates, min_cents: ms.min_cents, flat: ms.flat } : DEFAULT_MILESTONES;
  const prog = progRes.error || !progRes.data ? null : (progRes.data as Progress);
  if (error || !data) {
    return <Notice title="Your dashboard is getting set up">Check back in a little while.</Notice>;
  }
  const o = data as RepOverview;
  const link = repLink(o.rep.code);
  const qr = await qrFor(link);
  const sum = (s: string[]) => o.commissions.filter((c) => s.includes(c.status)).reduce((t, c) => t + c.amount_cents, 0);
  const month = currentMonthChicago();
  const projected = o.customers
    .filter((c) => !c.ended && c.first_paid_at && ["active", "trialing", "past_due"].includes(c.sub_status ?? ""))
    .flatMap((c) => projectedCommissions(c.first_paid_at ? `${c.first_paid_at.slice(0, 7)}-01` : null, c.basis_cents, o.policy.commission_years, month));
  const projectedCents = projected.reduce((t, p) => t + p.cents, 0);
  const f = o.funnel;
  const funnel: [string, number, string?][] = [
    ["Link visits", f.visits, `${f.visits_30d} in the last 30 days`],
    ["Free accounts", f.signups, `${pct(f.signups, f.visits)} of visits`],
    ["Started a bid", f.activated, `${pct(f.activated, f.signups)} of accounts`],
    ["Became paying", f.purchased, `${pct(f.purchased, f.signups)} of accounts`],
    ["Paying now", f.paying, f.canceled ? `${f.canceled} canceled` : undefined],
  ];
  const money: [string, number, string][] = [
    ["Pending", sum(["pending"]), "Paid this month; earned when the month closes"],
    ["Earned", sum(["earned", "approved"]), "On a statement, waiting for payout"],
    ["Paid to you", sum(["paid"]), "All time"],
    ["Projected", projectedCents, "Future anniversaries of active customers"],
  ];
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">Welcome, {o.rep.full_name.split(" ")[0]}</h1>
        <p className="mt-1 text-ink-soft">Share your link. Anyone who signs up through it stays connected to you, even if they buy months later.</p>
      </div>

      {welcome && (
        <Card className="p-5">
          <h2 className="text-lg font-bold">You&apos;re in. Here&apos;s where to start</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li><Link className="text-brand underline" href="/sales/how-you-get-paid">How you get paid</Link>: commissions, the 30-day hold and milestone boxes.</li>
            <li><Link className="text-brand underline" href="/sales/academy">Sales Academy</Link>: short lessons and quizzes. Passing them certifies you to sell.</li>
            <li><Link className="text-brand underline" href="/sales/preferences">My preferences</Link>: optional, sets how we celebrate wins with you.</li>
            <li><Link className="text-brand underline" href="/sales/leads">Leads</Link>: new company leads are shared out automatically; work each one with a call or email.</li>
          </ol>
        </Card>
      )}
      {attention && <AttentionCard data={attention} compact />}
      {successes && <SuccessCelebration items={successes} firstName={o.rep.full_name.split(" ")[0]} animate={prefs?.animations ?? true} />}
      {prefs && prefs.status === "not_started" && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <p><span className="font-semibold">Make the Sales Hub yours.</span> A short, optional survey sets how we celebrate wins with you and which rewards to suggest.</p>
          <Link href="/sales/preferences" className="font-semibold text-brand underline">Set my preferences</Link>
        </Card>
      )}
      {sectionOrder(layout).map((sec) => {
        if (sec === "team") return goal || wins ? <div key="team" className="space-y-8">{goal && <TeamGoalBoard g={goal} />}{wins && <TeamWins wins={wins} optedIn={!!(prefRes.data as { public_recognition?: boolean } | null)?.public_recognition} />}</div> : null;
        if (sec === "progress") return (
          <div key="progress" className="space-y-8">
      {comp && <CompensationCard c={comp} />}
      {ms && <MilestoneBoxes awards={ms.awards} accounts={ms.accounts} next={nextMilestone(rules, ms.accounts, comp?.model ?? "v3_active_mrr")} />}
      {acc?.enabled && <AcceleratorCard a={acc} />}
      {prog && bests && <QuestCard xp={bests[0]} quests={quests(prog)} />}
      {bests && rec && <PersonalBestsCard bests={bests} achievements={rec.achievements} />}

          </div>
        );
        if (sec === "portfolio") return (
          <div key="portfolio" className="space-y-8">
      <Card className="p-5">
        <h2 className="text-lg font-bold">Your referral link</h2>
        <p className="mb-3 mt-1 text-sm text-ink-soft">This link is permanent. A visit or free signup doesn&apos;t earn a commission by itself; the customer&apos;s paid subscription does.</p>
        <ShareLink link={link} qrSvg={qr.svg} qrDataUrl={qr.png} />
      </Card>

      <section aria-labelledby="funnel-h">
        <h2 id="funnel-h" className="mb-3 text-lg font-bold">Your funnel</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {funnel.map(([k, v, sub]) => (
            <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="text-2xl font-extrabold">{v}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</Card>
          ))}
        </div>
      </section>

      {successes && <CustomerSuccessCard items={successes} />}
          </div>
        );
        return (
          <div key="earnings">
      <section aria-labelledby="money-h">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="money-h" className="text-lg font-bold">Commissions</h2>
          <Link href="/sales/commissions" className="text-sm font-semibold text-brand underline">See every line</Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {money.map(([k, v, sub]) => (
            <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="text-2xl font-extrabold">{usd(v)}</p><p className="text-xs text-muted">{sub}</p></Card>
          ))}
        </div>
        {projected.length > 0 && (
          <p className="mt-2 text-xs text-muted">Next projected: {monthLabel(projected.map((p) => p.month).sort()[0])}. Projections assume each customer stays on their current plan.</p>
        )}
      </section>

          </div>
        );
      })}

      <Card className="p-5 text-sm text-ink-soft">
        <h2 className="text-base font-bold text-ink">How you&apos;re paid</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>One month of the customer&apos;s plan (before tax) for each sale, paid on the month-end statement after a 30-day refund hold.</li>
          <li>The same again on each anniversary while the customer is active and paid, {o.policy.commission_years} payments in total.</li>
          <li>{comp?.model === "v2_window" ? "Milestone gift boxes at 10, 25, 50 and every 50 accounts after that." : "One-time milestone bonuses at 10 ($25) and 25 ($75) qualifying customers, then every 25 customers a bonus of 3% to 5% of your qualifying active MRR. Each milestone pays once."}</li>
        </ul>
        <Link href="/sales/how-you-get-paid" className="mt-3 inline-block font-semibold text-brand underline">See the full walkthrough</Link>
      </Card>
    </div>
  );
}
