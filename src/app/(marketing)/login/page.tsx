import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/misc";
import { getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";
import { safeNext } from "@/lib/http/redirect";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null);
  if (await getUser()) redirect(next);
  return (
    <Container className="max-w-md py-16">
      <h1 className="text-3xl font-extrabold">Log in or create an account</h1>
      <p className="mt-2 text-ink-soft">No password needed. We&apos;ll email you a secure sign-in link and code.</p>
      {sp.error === "link" && <p role="alert" className="mt-4 rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger">That sign-in link expired or was already used. Request a new one below.</p>}
      {!isSupabaseConfigured() ? (
        <p className="mt-6 rounded-lg bg-warn-tint px-4 py-3 text-sm">Accounts are not configured on this server yet. You can still build and preview bids.</p>
      ) : (
        <LoginForm next={next} />
      )}
    </Container>
  );
}
