import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUser } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card } from "@/components/ui/misc";
import { NewCustomerForm } from "@/components/customers/new-customer-form";

export const metadata: Metadata = { title: "New customer", robots: { index: false } };

export default async function NewCustomerPage() {
  if (!(await getUser())) redirect("/login?next=/dashboard/customers/new");
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Breadcrumbs items={[{ label: "Customers", href: "/dashboard/customers" }, { label: "New customer" }]} />
      <div>
        <h1 className="text-3xl font-extrabold">New customer</h1>
        <p className="text-ink-soft">Add a customer now and pick them on any bid. Customers you name on a bid are added automatically.</p>
      </div>
      <Card className="p-5"><NewCustomerForm /></Card>
    </div>
  );
}
