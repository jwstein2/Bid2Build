"use client";
import Link from "next/link";
import { Card } from "@/components/ui/misc";

export function QuotaCard({ used, limit, unlimited, resetsAt }: { used: number; limit: number; unlimited: boolean; resetsAt: string }) {
  const reset = new Date(resetsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (unlimited) return <Card className="p-4"><p className="text-sm text-muted">Plan</p><p className="text-2xl font-extrabold text-ok">Unlimited</p><p className="text-xs text-muted">{used} exports this month</p></Card>;
  const left = Math.max(0, limit - used);
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">Free exports left this month</p>
      <p className="text-2xl font-extrabold">{left} <span className="text-base font-semibold text-muted">of {limit}</span></p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/5"><div className="h-full bg-teal" style={{ width: `${(Math.min(used, limit) / limit) * 100}%` }} /></div>
      <p className="mt-1.5 text-xs text-muted">Resets {reset} (your time). <Link href="/pricing" className="text-brand underline">Go unlimited</Link></p>
    </Card>
  );
}
