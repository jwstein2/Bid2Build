import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient, getUser } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CustomerTabs } from "@/components/comms/customer-tabs";
import { CommunicationsCenter } from "@/components/comms/communications-center";
import { loadCommAccess } from "@/lib/comms/server";

export const metadata: Metadata = { title: "Customer communications", robots: { index: false } };

export default async function CommunicationsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard/customers/communications");
  const access = await loadCommAccess(await createClient());
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Breadcrumbs items={[{ label: "Customers", href: "/dashboard/customers" }, { label: "Communications" }]} />
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Customers</h1>
        <CustomerTabs active="communications" pm={Boolean(access?.pm)} />
      </div>
      <div data-feature="customer_communications"><Suspense><CommunicationsCenter /></Suspense></div>
    </div>
  );
}
