import { redirect } from "next/navigation";

/** The Sales Hub moved into the sales portal (V8.3) so Sales Administrators can use it too. */
export default async function OldSalesHub({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  redirect(`/sales/admin${q.size ? `?${q.toString()}` : ""}`);
}
