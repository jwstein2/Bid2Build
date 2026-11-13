import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import { ConfirmDelete } from "../confirm-delete";
import { Card } from "@/components/ui/misc";
import { formatCurrency } from "@/lib/estimate/money";

export const metadata: Metadata = { title: "Saved cost items", robots: { index: false } };

async function remove(formData: FormData) {
  "use server";
  if (!(await getUser())) return;
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await (await createClient()).from(kind === "assembly" ? "assemblies" : "saved_items").delete().eq("id", id);
  revalidatePath("/dashboard/items");
}

export default async function ItemsPage() {
  const supabase = await createClient();
  const [{ data: items }, { data: asm }, { data: asmItems }] = await Promise.all([
    supabase.from("saved_items").select("*").order("name"),
    supabase.from("assemblies").select("*").order("name"),
    supabase.from("assembly_items").select("assembly_id"),
  ]);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Saved cost items</h1>
        <p className="text-ink-soft">Save favorites from any line item&apos;s menu, or select several items and choose “Save as assembly”. Add them to bids from “Suggested & saved items”.</p>
      </div>
      <Card>
        <h2 className="border-b border-line px-4 py-3 font-bold">Favorites</h2>
        {!items?.length ? <p className="p-6 text-center text-muted">No favorites yet.</p> : (
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium">{i.name}</span>
                <span className="flex items-center gap-4 text-muted">{i.unit_cost !== null ? `${formatCurrency(String(i.unit_cost))} / ${i.unit}` : i.unit}
                  <ConfirmDelete action={remove} fields={{ id: i.id, kind: "item" }} name={i.name} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="border-b border-line px-4 py-3 font-bold">Assemblies</h2>
        {!asm?.length ? <p className="p-6 text-center text-muted">No assemblies yet.</p> : (
          <ul className="divide-y divide-line">
            {asm.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium">{a.name}</span>
                <span className="flex items-center gap-4 text-muted">{(asmItems ?? []).filter((x) => x.assembly_id === a.id).length} items
                  <ConfirmDelete action={remove} fields={{ id: a.id, kind: "assembly" }} name={a.name} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
