import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Confirmation step for the lifecycle email unsubscribe link (the POST does the work, never this GET). */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ u?: string; s?: string; done?: string }> }) {
  const sp = await searchParams;
  return (
    <main id="main" className="flex min-h-screen items-start justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <Logo />
        <h1 className="mt-6 font-display text-2xl font-extrabold">Built2Bid tips and reminders</h1>
        {sp.done ? (
          <Notice tone="ok" className="mt-4">Done. You won&apos;t get any more tips or reminder emails. Your account, bids and sign-in emails aren&apos;t affected.</Notice>
        ) : (
          <form method="post" action="/api/email/unsubscribe" className="mt-4 space-y-4">
            <input type="hidden" name="u" value={(sp.u ?? "").slice(0, 64)} />
            <input type="hidden" name="s" value={(sp.s ?? "").slice(0, 64)} />
            <p className="text-ink-soft">Stop getting Built2Bid tips and reminder emails? Your account keeps working, and sign-in codes still arrive.</p>
            <button type="submit" className="rounded-lg bg-navy px-4 py-2 font-semibold text-white">Unsubscribe</button>
          </form>
        )}
      </div>
    </main>
  );
}
