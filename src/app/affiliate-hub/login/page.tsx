import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/misc";
import { Logo } from "@/components/layout/logo";
import { getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { safeHubNext } from "@/lib/affiliates/server";
import { AffiliateLoginForm } from "./login-form";

export const metadata: Metadata = { title: "Affiliate Hub sign in", robots: { index: false, follow: false } };

export default async function AffiliateLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeHubNext((await searchParams).next);
  if (isSupabaseConfigured() && (await getUser())) redirect(next);
  return (
    <Container className="max-w-md py-16">
      <Logo />
      <h1 className="mt-8 text-3xl font-extrabold">Built2Bid Affiliate Hub</h1>
      <p className="mt-2 text-ink-soft">For approved and invited affiliates. Sign in with the email you applied or were invited with, and we&apos;ll email you a code.</p>
      {isSupabaseConfigured() ? <AffiliateLoginForm next={next} /> : <p className="mt-6 rounded-lg bg-warn-tint px-4 py-3 text-sm">Accounts are not configured on this server yet.</p>}
      <p className="mt-8 text-sm text-muted">Not an affiliate yet? <Link href="/affiliates" className="underline">Learn about the program</Link>.</p>
    </Container>
  );
}
