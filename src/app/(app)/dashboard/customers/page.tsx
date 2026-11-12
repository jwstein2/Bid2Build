import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Saved customers", robots: { index: false } };

async function remove(formData: FormData) {
  "use server";
  if (!(await getUser())) return;
  const id = String(formData.get("id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(id)) await (await createClient()).from("customers").delete().eq("id", id);
  revalidatePath("/dashboard/customers");
}

export default async function CustomersPage() {
  const { data } = await (await createClient()).from("customers").select("id, name, email, phone, project_address").order("name");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Saved customers</h1>
        <p className="text-ink-soft">Save a customer from the Customer & project step of any bid, then reuse them on future bids.</p>
      </div>
      <Card>
        {!data?.length ? <p className="p-8 text-center text-muted">No saved customers yet.</p> : (
          <ul className="divide-y divide-line">
            {data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-sm text-muted">{[c.email, c.phone, c.project_address].filter(Boolean).join(" · ")}</p>
                </div>
                <form action={remove}><input type="hidden" name="id" value={c.id} /><button className="text-sm text-danger hover:underline">Delete</button></form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
