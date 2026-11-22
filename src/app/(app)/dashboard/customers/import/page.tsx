import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CustomerImport } from "@/components/customers/customer-import";

export const metadata: Metadata = { title: "Import customers", robots: { index: false } };

/** Customers → Import: bring in past customers from a QuickBooks export or any CSV / Excel list. */
export default async function CustomerImportPage() {
  if (!(await getUser())) redirect("/login?next=/dashboard/customers/import");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Breadcrumbs items={[{ label: "Customers", href: "/dashboard/customers" }, { label: "Import customers" }]} />
      <div>
        <h1 className="text-3xl font-extrabold">Import customers</h1>
        <p className="text-ink-soft">Upload the customer list you export from QuickBooks (or any spreadsheet) to bring in all your past customers at once. Duplicates are found and skipped. Looking for something else? See <Link href="/import" className="font-semibold text-accent-ink underline">Add existing data</Link>.</p>
      </div>
      <CustomerImport />
    </div>
  );
}
