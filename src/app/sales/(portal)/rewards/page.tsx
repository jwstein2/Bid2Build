import Link from "next/link";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { requireSalesRep } from "@/lib/sales/server";
import { usd } from "@/lib/sales/format";
import { AWARD_STATUS, REWARD_CATEGORIES } from "@/lib/sales/preferences";

export const metadata = { title: "Rewards" };

interface MyRewards {
  catalog: { id: string; name: string; description: string | null; category: string; eligibility: string | null; value_cents: number }[];
  awards: { id: string; name: string | null; reason: string; value_cents: number; tax_category: string; status: string; proposed_at: string; delivered_at: string | null }[];
}

export default async function RewardsPage() {
  const { db } = await requireSalesRep();
  const { data, error } = await db.rpc("sales_my_rewards");
  if (error || !data) return <Notice title="Rewards are getting set up">Check back in a little while.</Notice>;
  const r = data as MyRewards;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Rewards</h1>
        <p className="mt-1 text-ink-soft">Rewards the owner has approved for recognizing great work. They&apos;re given at the owner&apos;s discretion and don&apos;t replace or change your commissions.</p>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-bold">Your rewards</h2>
        {r.awards.length === 0 ? <p className="mt-2 text-sm text-ink-soft">None yet. When a reward is approved for you, it shows here with its status.</p> : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {r.awards.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div><p className="font-semibold">{a.name ?? "Reward"} · {usd(a.value_cents)}</p><p className="text-ink-soft">{a.reason}</p></div>
                <Badge tone={a.status === "delivered" ? "ok" : a.status === "proposed" ? "neutral" : "brand"}>{a.status === "proposed" ? "Waiting for owner approval" : AWARD_STATUS[a.status] ?? a.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Cash rewards are paid on your monthly statement. Gift cards and other prizes with cash value may be reportable income; Built2Bid will tell you when that applies.</p>
      </Card>

      <section aria-labelledby="catalog-h">
        <h2 id="catalog-h" className="mb-3 text-lg font-bold">Reward catalog</h2>
        {r.catalog.length === 0 ? <Notice>The owner hasn&apos;t published any rewards yet. Tell us what you&apos;d enjoy in <Link href="/sales/preferences" className="font-semibold underline">My preferences</Link>.</Notice> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {r.catalog.map((c) => (
              <Card key={c.id} className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{REWARD_CATEGORIES[c.category] ?? c.category}</p>
                <p className="mt-1 font-bold">{c.name}</p>
                <p className="text-sm font-semibold">{usd(c.value_cents)}</p>
                {c.description && <p className="mt-1 text-sm text-ink-soft">{c.description}</p>}
                {c.eligibility && <p className="mt-2 text-xs text-muted">Eligibility: {c.eligibility}</p>}
              </Card>
            ))}
          </div>
        )}
        <p className="mt-3 text-sm text-ink-soft">Pick your favorite reward categories in <Link href="/sales/preferences" className="font-semibold text-brand underline">My preferences</Link>.</p>
      </section>
    </div>
  );
}
