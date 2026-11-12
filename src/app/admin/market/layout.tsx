import Link from "next/link";

const sub = [
  ["/admin/market", "Overview"], ["/admin/market/trades", "Trade analytics"], ["/admin/market/materials", "Material pricing"],
  ["/admin/market/labor", "Labor analytics"], ["/admin/market/geography", "Geographic"], ["/admin/market/anomalies", "Pricing anomalies"],
  ["/admin/market/quality", "Data quality"], ["/admin/market/classifications", "Classifications"], ["/admin/market/settings", "Settings & demo data"],
];

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav aria-label="Market Intelligence" className="-mt-2 flex flex-wrap gap-1 border-b border-line pb-3 text-sm">
        <span className="mr-2 self-center font-display font-bold text-ink">Market Intelligence</span>
        {sub.map(([href, label]) => <Link key={href} href={href} className="rounded-md px-2.5 py-1 font-medium text-ink-soft hover:bg-surface hover:text-ink">{label}</Link>)}
      </nav>
      <p className="text-xs text-muted">Internal and admin-only. De-identified, aggregated data. Never share figures with contractors or customers, and never use them to recommend or coordinate prices.</p>
      {children}
    </div>
  );
}
