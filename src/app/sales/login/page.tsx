import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/misc";
import { Logo } from "@/components/layout/logo";
import { getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SalesLoginForm } from "./sales-login-form";
import { safeSalesNext } from "@/lib/sales/next";

export const metadata: Metadata = { title: "Sales portal sign in", robots: { index: false, follow: false } };

export default async function SalesLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeSalesNext((await searchParams).next);
  if (isSupabaseConfigured() && (await getUser())) redirect(next);
  return (
    <Container className="max-w-md py-16">
      <Logo />
      <h1 className="mt-8 text-3xl font-extrabold">Built2Bid sales portal</h1>
      <p className="mt-2 text-ink-soft">For the Built2Bid sales team. Sign in with the email address you were invited with and we&apos;ll email you a code.</p>
      {isSupabaseConfigured() ? <SalesLoginForm next={next} /> : <p className="mt-6 rounded-lg bg-warn-tint px-4 py-3 text-sm">Accounts are not configured on this server yet.</p>}
      <p className="mt-8 text-sm text-muted">Looking for your contractor account? <a href="/login" className="underline">Log in here</a>.</p>
    </Container>
  );
}
