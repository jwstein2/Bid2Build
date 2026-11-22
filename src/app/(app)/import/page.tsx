import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Banknote, FileSpreadsheet, HardHat, Landmark, Link2, Tags, Users } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { isFinancialsEnabled, isPmEnabled } from "@/lib/env";
import { isQuickBooksEnabled, QB_PAGE_PATH } from "@/lib/quickbooks/config";
import { Card } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Add existing data", robots: { index: false } };

interface Option { title: string; body: string; files: string; href: string; cta: string; Icon: typeof Users; testid: string }

/**
 * Add existing data: one page that lists every way to bring past records into Built2Bid (customers, bank statements,
 * a bank connection, team, price lists), so a new account isn't empty. Each card links to the screen that does the
 * import; nothing here reads or writes data. Linked from beside Connect QuickBooks, Customers and Financials.
 */
export default async function AddExistingDataPage() {
  if (!(await getUser())) redirect("/login?next=/import");
  const fin = isFinancialsEnabled();
  const pm = isPmEnabled();
  const options: Option[] = [
    { title: "Past customers", body: "Upload the customer list you export from QuickBooks (Customers → Export to Excel), QuickBooks Desktop, or any spreadsheet. Duplicates are found and skipped.", files: "CSV or Excel (.xlsx)", href: "/dashboard/customers/import", cta: "Import customers", Icon: Users, testid: "import-hub-customers" },
    ...(fin ? [
      { title: "Bank statements", body: "Upload statements you download from your bank's website. Lines go into reconciliation, and the latest ending balance can start your cash forecast.", files: "CSV, OFX or QFX (download one of these from your bank; PDF statements can't be read)", href: "/financials/accounting/bank", cta: "Upload a bank statement", Icon: Banknote, testid: "import-hub-bank-statement" },
      { title: "Connect your bank", body: "Link your business bank account (read-only) to bring in balances and recent transactions automatically, usually the last 90 days.", files: "No file needed", href: "/financials/banks", cta: "Connect a bank", Icon: Landmark, testid: "import-hub-plaid" },
    ] : []),
    ...(pm ? [{ title: "Employees and subcontractors", body: "Load your crew or sub list from a template, a payroll export (Gusto, ADP, Paychex, QuickBooks Payroll) or a QuickBooks vendor list.", files: "CSV or Excel (.xlsx)", href: "/projects/team/import", cta: "Import your team", Icon: HardHat, testid: "import-hub-team" }] : []),
    { title: "Price list and saved items", body: "Upload a supplier price list or your own rates so they fill in on every bid.", files: "CSV or Excel (.xlsx)", href: "/dashboard/items/import", cta: "Import a price list", Icon: Tags, testid: "import-hub-items" },
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="import-hub">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-extrabold text-navy"><FileSpreadsheet className="h-7 w-7 text-accent-ink" aria-hidden /> Add existing data</h1>
        <p className="mt-1 text-ink-soft">Bring in your past customers, bank history, team and prices so Built2Bid starts with your real business. Every import shows you each row before anything is saved.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {options.map((o) => (
          <Card key={o.href} className="flex flex-col gap-3 p-5" data-testid={o.testid}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-navy"><o.Icon className="h-5 w-5 text-accent-ink" aria-hidden /> {o.title}</h2>
            <p className="text-sm text-ink-soft">{o.body}</p>
            <p className="text-xs text-muted"><span className="font-semibold">Accepts:</span> {o.files}</p>
            <Link href={o.href} className="mt-auto inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg bg-navy px-4 text-sm font-semibold text-white hover:bg-navy/90">{o.cta} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </Card>
        ))}
      </div>
      <Card className="space-y-2 p-5" data-testid="import-hub-quickbooks">
        <h2 className="flex items-center gap-2 text-lg font-bold text-navy"><Link2 className="h-5 w-5 text-accent-ink" aria-hidden /> Coming from QuickBooks?</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li><strong>Customers:</strong> in QuickBooks Online go to Customers, select Export to Excel next to Print, then upload that file under <Link href="/dashboard/customers/import" className="font-semibold text-accent-ink underline">Import customers</Link>.</li>
          {fin && <li><strong>Bank history:</strong> download CSV, OFX or QFX files from your bank and upload them under <Link href="/financials/accounting/bank" className="font-semibold text-accent-ink underline">Bank statements</Link>.</li>}
          {pm && <li><strong>Vendors and subs:</strong> export your QuickBooks vendor list and upload it under <Link href="/projects/team/import" className="font-semibold text-accent-ink underline">Import your team</Link> (choose Subcontractors).</li>}
          {pm && isQuickBooksEnabled() && <li><strong>Crew hours:</strong> <Link href={QB_PAGE_PATH} className="font-semibold text-accent-ink underline">Connect QuickBooks</Link> to send approved hours to QuickBooks Payroll. That connection sends hours to QuickBooks; it doesn&apos;t bring data in.</li>}
        </ul>
      </Card>
    </div>
  );
}
