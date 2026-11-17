import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import { Badge, Card } from "@/components/ui/misc";
import { ConfirmDelete } from "../confirm-delete";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CustomerPhotos } from "@/components/operations/customer-photos";
import { CustomerTabs } from "@/components/comms/customer-tabs";
import { loadCommAccess } from "@/lib/comms/server";
import { CONTACT_STATUS_LABEL, type ContactStatus } from "@/lib/comms/types";

export const metadata: Metadata = { title: "Customers", robots: { index: false } };

async function remove(formData: FormData) {
  "use server";
  if (!(await getUser())) return;
  const id = String(formData.get("id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(id)) await (await createClient()).from("customers").delete().eq("id", id);
  revalidatePath("/dashboard/customers");
}

export default async function CustomersPage() {
  const user = await getUser();
  // The layout redirects too, but pages render in parallel with it: never assume a session here.
  if (!user) redirect("/login?next=/dashboard/customers");
  const supabase = await createClient();
  // Own customers only (company managers can also read teammates' company customers through RLS).
  const [{ data }, access] = await Promise.all([
    supabase.from("customers").select("id, name, email, phone, project_address").eq("user_id", user.id).order("name"),
    loadCommAccess(supabase),
  ]);
  const pm = Boolean(access?.pm && access.perms.includes("view_communications"));
  // Communication status per customer email (Project Command Center only; read under RLS).
  const statusByEmail = new Map<string, ContactStatus>();
  if (pm && access?.accountId) {
    const emails = (data ?? []).map((c) => c.email?.toLowerCase()).filter(Boolean) as string[];
    if (emails.length) {
      const { data: cs } = await supabase.from("comm_contacts").select("email, status").eq("account_id", access.accountId).in("email", emails.slice(0, 500));
      for (const c of (cs ?? []) as { email: string; status: ContactStatus }[]) statusByEmail.set(c.email, c.status);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Breadcrumbs items={[{ label: "Customers" }]} />
      <div className="space-y-3">
        <h1 className="text-3xl font-extrabold">Customers</h1>
        <CustomerTabs active="directory" pm={pm} />
        <p className="text-ink-soft">Save a customer from the Customer & project step of any bid, then reuse them on future bids.</p>
      </div>
      <Card>
        {!data?.length ? <p className="p-8 text-center text-muted">No saved customers yet.</p> : (
          <ul className="divide-y divide-line">
            {data.map((c) => {
              const st = c.email ? statusByEmail.get(c.email.toLowerCase()) : undefined;
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/dashboard/customers/${c.id}`} className="font-semibold underline-offset-2 hover:underline">{c.name}</Link>
                    <p className="text-sm text-muted">{[c.email, c.phone, c.project_address].filter(Boolean).join(" · ")}</p>
                    {pm && st && <Badge tone={st === "eligible" ? "ok" : st === "replied" ? "brand" : "warn"} className="mt-1">Follow-ups: {CONTACT_STATUS_LABEL[st]}</Badge>}
                  </div>
                  <ConfirmDelete action={remove} fields={{ id: c.id }} name={c.name} />
                  <CustomerPhotos customerId={c.id} name={c.name} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
