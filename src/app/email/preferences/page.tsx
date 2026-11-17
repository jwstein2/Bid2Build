import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui/misc";
import { checkUnsubSig } from "@/lib/comms/tokens";
import { unsubscribeByMessage } from "@/lib/comms/unsubscribe";
import { accountBranding } from "@/lib/comms/server";

export const metadata: Metadata = { title: "Email preferences", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

async function optOut(formData: FormData) {
  "use server";
  const m = String(formData.get("m") ?? ""), s = String(formData.get("s") ?? "");
  if (!checkUnsubSig(m, s)) redirect("/email/preferences?invalid=1");
  await unsubscribeByMessage(createAdminClient(), m);
  redirect(`/email/preferences?m=${encodeURIComponent(m)}&s=${encodeURIComponent(s)}&done=1`);
}

/**
 * Landing page for the unsubscribe link in a contractor's follow-up or progress email. Opening the
 * page changes nothing (link scanners open links); the button does.
 */
export default async function EmailPreferences({ searchParams }: { searchParams: Promise<{ m?: string; s?: string; done?: string; invalid?: string }> }) {
  const sp = await searchParams;
  const valid = checkUnsubSig(sp.m, sp.s);
  let company = "this contractor", kind = "nurture";
  if (valid) {
    const admin = createAdminClient();
    const { data } = await admin.from("comm_messages").select("account_id, kind").eq("id", sp.m!).maybeSingle();
    if (data) { company = (await accountBranding(admin, String(data.account_id))).companyName; kind = String(data.kind); }
  }
  const what = kind === "nurture" ? "follow-up emails" : "project progress emails";
  return (
    <main id="main" className="flex min-h-screen items-start justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <h1 className="font-display text-2xl font-extrabold">Email preferences</h1>
        {!valid || sp.invalid ? (
          <Notice tone="warn" className="mt-4">This link isn&apos;t valid. Reply to the email and ask to be removed, and the sender will take care of it.</Notice>
        ) : sp.done ? (
          <Notice tone="ok" className="mt-4" >Done. {company} won&apos;t send you any more {what} through Built2Bid.</Notice>
        ) : (
          <form action={optOut} className="mt-4 space-y-4">
            <input type="hidden" name="m" value={sp.m} />
            <input type="hidden" name="s" value={sp.s} />
            <p className="text-ink-soft">Stop getting {what} from <strong>{company}</strong>? You can still contact them any time.</p>
            <button type="submit" className="min-h-11 rounded-lg bg-navy px-4 py-2 font-semibold text-white" data-testid="confirm-unsubscribe">Unsubscribe</button>
          </form>
        )}
        <p className="mt-6 text-xs text-muted">Sent for {company} using Built2Bid.</p>
      </div>
    </main>
  );
}
