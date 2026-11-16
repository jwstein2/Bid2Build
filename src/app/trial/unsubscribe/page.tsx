import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Stop trial emails", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Confirmation step for the check-in unsubscribe link (the POST does the work, never this GET). */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ i?: string; s?: string; done?: string }> }) {
  const sp = await searchParams;
  return (
    <main id="main" className="flex min-h-screen items-start justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <Logo />
        <h1 className="mt-6 font-display text-2xl font-extrabold">Trial check-in emails</h1>
        {sp.done ? (
          <Notice tone="ok" className="mt-4">Done. You won&apos;t get any more trial check-in emails. Your account and trial aren&apos;t affected.</Notice>
        ) : (
          <form method="post" action="/api/trial/unsubscribe" className="mt-4 space-y-4">
            <input type="hidden" name="i" value={(sp.i ?? "").slice(0, 64)} />
            <input type="hidden" name="s" value={(sp.s ?? "").slice(0, 64)} />
            <p className="text-ink-soft">Stop the two optional emails about your free week? Your trial keeps working.</p>
            <button type="submit" className="rounded-lg bg-navy px-4 py-2 font-semibold text-white">Stop check-in emails</button>
          </form>
        )}
      </div>
    </main>
  );
}
