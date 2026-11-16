import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { getUser } from "@/lib/supabase/server";
import { ActivateTrial } from "./activate-client";

export const metadata: Metadata = { title: "Activate your free week", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Lands here from the invite email (token in the URL fragment). Opening the page never activates
 * anything: the signed-in person has to tap Activate, which POSTs the token to /api/trial/activate.
 */
export default async function ActivatePage() {
  const user = await getUser();
  return (
    <main id="main" className="flex min-h-screen items-start justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <Logo />
        <ActivateTrial signedInAs={user ? (user.emailVerified ? user.email : null) : undefined} />
      </div>
    </main>
  );
}
