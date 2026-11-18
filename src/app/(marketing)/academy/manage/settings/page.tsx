import { notFound } from "next/navigation";
import { Flash } from "@/components/creator/flash";
import { Submit } from "@/components/academy/controls";
import { field, label } from "../ui";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";
import { saveSettings } from "../actions";

type S = { name: string; tagline: string; description: string; rules: string[]; online_window_minutes: number; free_members_can_post: boolean; premium_enabled: boolean; premium_bundles: string[]; points_reaction: number; points_helpful: number; points_course: number; daily_point_cap: number; pair_daily_cap: number };

export default async function ManageSettings({ searchParams }: PageProps<"/academy/manage/settings">) {
  if (!(await requireAcademyStaff(["admin"]))) notFound();
  const sp = await searchParams;
  const { data } = await createAdminClient().from("academy_settings").select("*").maybeSingle();
  const st = data as S | null;
  if (!st) notFound();
  const num = (k: keyof S, l: string, min: number, max: number) => <label className={label}>{l}<input name={k} type="number" min={min} max={max} required defaultValue={st[k] as number} className={field} /></label>;
  return (
    <>
      <Flash msg={typeof sp.msg === "string" ? sp.msg : undefined} err={typeof sp.err === "string" ? sp.err : undefined} />
      <form action={saveSettings} className="grid max-w-3xl gap-4 rounded-xl border border-line bg-surface p-5">
        <label className={label}>Name<input name="name" required minLength={3} maxLength={80} defaultValue={st.name} className={field} /></label>
        <label className={label}>Tagline<input name="tagline" maxLength={160} defaultValue={st.tagline} className={field} /></label>
        <label className={label}>Description<textarea name="description" maxLength={600} rows={3} defaultValue={st.description} className={field} /></label>
        <label className={label}>Community rules (one per line, up to 12)<textarea name="rules" rows={6} defaultValue={st.rules.join("\n")} className={field} /></label>
        <div className="grid gap-4 sm:grid-cols-3">
          {num("online_window_minutes", "Online = active in the last N minutes", 1, 60)}
          {num("points_reaction", "Points per like received", 0, 10)}
          {num("points_helpful", "Points per helpful answer", 0, 50)}
          {num("points_course", "Points per finished lesson", 0, 20)}
          {num("daily_point_cap", "Daily points cap per member", 1, 500)}
          {num("pair_daily_cap", "Daily points from any one member", 1, 50)}
        </div>
        <fieldset className="rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Access</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="free_members_can_post" defaultChecked={st.free_members_can_post} /> Free members can post</label>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="premium_enabled" defaultChecked={st.premium_enabled} /> Premium content is enabled</label>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="bundle_unlimited" defaultChecked={st.premium_bundles.includes("unlimited")} /> Built2Bid Unlimited subscribers get Academy premium</label>
          <p className="mt-2 text-xs text-muted">This only reads the plan people already have. It creates no Stripe products, prices or charges, and doesn&apos;t change anyone&apos;s subscription. Admins can also grant premium to a member by hand.</p>
        </fieldset>
        <div className="flex justify-end"><Submit>Save settings</Submit></div>
      </form>
    </>
  );
}
