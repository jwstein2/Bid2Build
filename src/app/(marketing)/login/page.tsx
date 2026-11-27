import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/misc";
import { getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";
import { safeNext } from "@/lib/http/redirect";
import { isSmsSignInEnabled } from "@/lib/auth/phone";
import { emailOtpLength } from "@/lib/auth/config";
import { LogoMark, Wordmark } from "@/components/layout/logo";

export const metadata: Metadata = { title: "Sign in", robots: { index: false }, alternates: { canonical: "/login" } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null);
  if (await getUser()) redirect(next);
  return (
    // data-app-auth: inside the installed desktop/phone app the marketing header and footer are hidden on this screen
    // (globals.css), so it opens as a clean Built2Bid sign-in window. In a normal browser tab nothing changes.
    <Container className="max-w-md py-16">
      <div data-app-auth="" hidden />
      <div className="flex items-center gap-2.5 font-display text-2xl font-extrabold tracking-tight" aria-hidden>
        <LogoMark className="h-12 w-12 shrink-0" />
        <Wordmark />
      </div>
      <h1 className="mt-6 text-3xl font-extrabold">Welcome back to Built2Bid</h1>
      <p className="mt-1 font-semibold text-accent-ink">Win the job. Run the job. Grow the business.</p>
      <p className="mt-3 text-ink-soft">{isSmsSignInEnabled() ? "No password needed. We'll text a 6-digit code to your phone. You can still use email if you prefer." : `No password needed. We'll email you a ${emailOtpLength()}-digit code to enter here.`}</p>
      <p className="mt-2 text-sm text-muted">New to Built2Bid? Continue with your email and your free account is created as you sign in. There&apos;s no password to forget: every sign-in gets a fresh code.</p>
      {sp.error === "link" && <p role="alert" className="mt-4 rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger">That sign-in link expired or was already used. Enter your email below and we&apos;ll send you a new code.</p>}
      {!isSupabaseConfigured() ? (
        <p className="mt-6 rounded-lg bg-warn-tint px-4 py-3 text-sm">Accounts are not configured on this server yet. You can still build and preview bids.</p>
      ) : (
        <LoginForm next={next} />
      )}
    </Container>
  );
}
