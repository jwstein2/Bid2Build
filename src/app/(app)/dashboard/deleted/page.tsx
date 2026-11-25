import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui/misc";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { missingMigration } from "@/lib/operations/server";
import { DeletedBidList, type DeletedBid } from "./deleted-list";

export const metadata: Metadata = { title: "Recently deleted bids", robots: { index: false } };

/**
 * Bids that were deleted (hidden) and can be restored, with who deleted them, when and why. Solo accounts see
 * their own; in a company, authors see theirs and company admins see the whole company's (deleted_estimates_list).
 */
export default async function DeletedBidsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard/deleted");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("deleted_estimates_list");
  const pending = Boolean(error && missingMigration(error));
  const rows = (Array.isArray(data) ? data : []) as DeletedBid[];
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Breadcrumbs items={[{ label: "My bids", href: "/dashboard?view=table" }, { label: "Recently deleted" }]} />
      <div>
        <h1 className="text-2xl font-extrabold text-navy">Recently deleted bids</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Deleted bids are hidden from My bids, reports and search, but never erased. Each delete and restore is kept in the audit log with who did it and when.
        </p>
      </div>
      {pending ? (
        <Card className="p-6 text-sm text-ink-soft" role="status">Deleting bids needs a quick database update. Please check back later.</Card>
      ) : error ? (
        <Card className="p-6 text-sm text-danger" role="alert">Couldn&apos;t load deleted bids. Refresh to try again.</Card>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center"><p className="font-semibold">No deleted bids.</p><p className="mt-1 text-sm text-muted">When a bid is deleted from My bids, it shows up here so it can be restored.</p></Card>
      ) : <DeletedBidList rows={rows} />}
    </div>
  );
}
