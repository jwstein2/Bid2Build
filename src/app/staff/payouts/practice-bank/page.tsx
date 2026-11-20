import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { loadStaffSelf } from "@/lib/staff/server";

export const metadata = { title: "Practice bank connection" };

/**
 * Stand-in for the provider's hosted bank page while payouts use the practice provider (test mode only). No bank
 * details are collected: it attaches a fixed practice account so the whole flow can be tried end to end.
 */
export default async function PracticeBankPage() {
  await loadStaffSelf("/staff/payouts");
  const { data: s } = await createAdminClient().from("payout_settings").select("mode, provider").eq("id", true).maybeSingle();
  if (s?.mode === "live" || (s?.provider ?? "mock") !== "mock") notFound();
  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-line bg-warn-tint px-4 py-3 text-sm"><strong>Practice only.</strong> This page stands in for the payment provider&apos;s secure bank page. No real bank is connected and no money moves.</p>
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h1 className="text-xl font-extrabold">Connect a practice bank account</h1>
        <p className="mt-2 text-sm text-ink-soft">On the real page you&apos;d sign in to your bank or enter your routing and account number with the provider. Built2Bid only ever receives the bank name and last 4 digits.</p>
        <div className="mt-4 rounded-lg border border-line p-4 text-sm"><p className="font-semibold">STRIPE TEST BANK (practice)</p><p className="text-ink-soft">Checking ••6789</p></div>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href="/api/payouts/return" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-5 font-semibold text-white">Use this practice account</a>
          <Link href="/staff/payouts" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-5 font-semibold">Cancel</Link>
        </div>
      </section>
    </div>
  );
}
