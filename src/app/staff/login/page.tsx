import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/layout/logo";
import { isSupabaseConfigured } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";
import { SalesLoginForm } from "../../sales/login/sales-login-form";
import { safeStaffNext } from "@/lib/staff/next";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false } };

export default async function StaffLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeStaffNext((await searchParams).next);
  if (isSupabaseConfigured() && (await getUser())) redirect(next);
  return (
    <div className="max-w-md py-10">
      <Logo />
      <h1 className="mt-8 text-3xl font-extrabold">Built2Bid staff sign in</h1>
      <p className="mt-2 text-ink-soft">Use the email address your onboarding link was sent to. We&apos;ll email you a code; no password.</p>
      {isSupabaseConfigured() ? <SalesLoginForm next={next} label="Sign in with email" /> : <p className="mt-6 rounded-lg bg-warn-tint px-4 py-3 text-sm">Accounts are not configured on this server yet.</p>}
    </div>
  );
}
