import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { STATUS_LABEL } from "@/lib/sales/nurture/templates";

export interface CampaignStats {
  enabled?: boolean; nurture_active: number; follow_up_active: number; replied: number; meetings: number; accounts_created: number; estimates_started: number;
  estimates_completed: number; converted: number; completed: number; attention: number; emails_sent: number; failed: number; unsubscribed: number; paused: number;
  needs_attention?: { lead_id: string; company_name: string; status: string; at: string }[];
}

/** Follow-up campaign results (last 90 days), part of the existing Sales Hub overview and analytics. */
export function CampaignStatsCard({ s, title = "Follow-up emails (last 90 days)", links = true }: { s: CampaignStats; title?: string; links?: boolean }) {
  const tiles: [string, number][] = [
    ["Leads in nurture", s.nurture_active], ["Leads in follow-up", s.follow_up_active], ["Replies received", s.replied], ["Meetings scheduled", s.meetings],
    ["Accounts created", s.accounts_created], ["First estimates started", s.estimates_started], ["First estimates completed", s.estimates_completed],
    ["Paid conversions", s.converted], ["Campaigns completed", s.completed], ["Need your attention", s.attention],
  ];
  return (
    <Card className="p-5" data-testid="campaign-stats">
      <h2 className="text-lg font-bold">{title}</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-lg bg-paper p-3"><dt className="text-xs text-muted">{label}</dt><dd className="text-2xl font-extrabold tabular-nums">{n ?? 0}</dd></div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">Counts come from campaign records and accounts linked to your leads. Email opens are never counted.</p>
      {links && s.needs_attention && s.needs_attention.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {s.needs_attention.slice(0, 8).map((a) => (
            <li key={`${a.lead_id}-${a.at}`}><Link href={`/sales/leads/${a.lead_id}`} className="font-semibold text-brand underline">{a.company_name}</Link> · {STATUS_LABEL[a.status] ?? a.status}{a.status === "replied" || a.status === "meeting_scheduled" ? ": follow up personally" : a.status === "failed_delivery" ? ": email bounced, try calling" : ": paused over a week"}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
