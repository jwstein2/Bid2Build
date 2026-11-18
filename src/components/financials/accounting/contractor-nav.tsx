import Link from "next/link";

/** Contractor Mode shortcuts: projects, estimates, invoices, customer balances, job profitability and cash. Every page re-checks access. */
export function ContractorNav({ company }: { company: boolean }) {
  const items = [
    { label: "Projects", href: "/financials/records?view=jobs" },
    { label: "Estimates", href: "/dashboard" },
    { label: "Invoices", href: "/financials/records?view=invoices" },
    { label: "Customer balances", href: "/financials/receivables" },
    { label: "Job profitability", href: company ? "/financials/reports" : "/financials/records?view=jobs" },
    { label: "Cash received", href: "/financials/records?view=payments" },
  ];
  return (
    <nav aria-label="Financials" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-guide="fin.contractor-nav" data-testid="fin-contractor-nav">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((n) => <li key={n.label}><Link href={n.href} className="inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-semibold text-ink-soft hover:text-ink">{n.label}</Link></li>)}
      </ul>
    </nav>
  );
}
