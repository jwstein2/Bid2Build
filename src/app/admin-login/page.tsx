import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/misc";
import { isSupabaseConfigured } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin/server";
import { safeAdminNext } from "@/lib/auth/admin-gate";
import { AdminLoginForm } from "./admin-login-form";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Owner admin sign-in. Same account and email code as the regular Built2Bid sign-in; the admin area then asks
 * for the authenticator code (two-step sign-in). Never linked from the public site or the customer app.
 */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; denied?: string }> }) {
  const sp = await searchParams;
  const next = safeAdminNext(sp.next);
  const user = isSupabaseConfigured() ? await getUser() : null;
  // Signed in as the owner: straight on. The admin area itself sends an email-code-only session to /auth/mfa.
  if (user && (await isAdminUser(user))) redirect(next);
  return (
    <main id="main" className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md space-y-4 p-6">
        <Logo />
        <h1 className="flex items-center gap-2 text-2xl font-extrabold"><ShieldCheck className="h-6 w-6 text-brand" aria-hidden /> Admin sign in</h1>
        {!isSupabaseConfigured() ? (
          <Notice tone="warn">Accounts are not configured on this server yet.</Notice>
        ) : user ? (
          <div className="space-y-3" data-testid="admin-login-denied">
            <Notice tone="danger">You&apos;re signed in as {user.email ?? "another account"}, which isn&apos;t an admin account.</Notice>
            <p className="text-sm text-ink-soft">Sign out, then sign in with the admin account.</p>
            <form action="/auth/signout" method="post"><Button type="submit" variant="secondary">Sign out</Button></form>
          </div>
        ) : (
          <>
            <p className="text-sm text-ink-soft">Sign in with your regular Built2Bid account email. We&apos;ll email you a code, then ask for the 6-digit code from your authenticator app.</p>
            <AdminLoginForm next={next} />
          </>
        )}
      </Card>
    </main>
  );
}
