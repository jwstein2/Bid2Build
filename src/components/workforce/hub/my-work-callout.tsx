import { Clock } from "lucide-react";
import { createClient, getUser } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { ButtonLink } from "@/components/ui/button";

/**
 * V8.3.1: for anyone whose login is linked to a Staff record, a one-tap way into My work (the worker app) at the top
 * of Home / Bids, so workers who land there after signing in never have to hunt for it. Renders nothing otherwise.
 */
export async function MyWorkCallout({ className = "" }: { className?: string }) {
  if (!isPmEnabled()) return null;
  const user = await getUser();
  if (!user) return null;
  const { data } = await (await createClient()).from("pm_resources").select("id").eq("linked_user_id", user.id).eq("kind", "staff").eq("status", "active").limit(1);
  if (!Array.isArray(data) || data.length === 0) return null;
  return (
    <section className={`flex flex-wrap items-center gap-3 rounded-xl border border-accent-ink/30 bg-surface p-4 ${className}`} data-testid="my-work-callout">
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper text-accent-ink"><Clock className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0">
          <p className="font-extrabold text-navy">My work</p>
          <p className="text-sm text-ink-soft">Today&apos;s jobs, your week and the time clock.</p>
        </div>
      </div>
      <ButtonLink href="/clock" data-testid="my-work-open">Open My work</ButtonLink>
    </section>
  );
}
