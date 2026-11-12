"use client";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[ui]", error.digest ?? error.message); }, [error]);
  return (
    <main id="main" role="alert" className="grid min-h-[70vh] place-items-center px-4 text-center">
      <div>
        <h1 className="text-3xl font-extrabold">Something went wrong</h1>
        <p className="mt-2 text-ink-soft">Your drafts are saved in this browser. Try again, or go back to your dashboard.</p>
        {error.digest && <p className="mt-1 text-xs text-muted">Reference: {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-3">
          <button onClick={reset} className="rounded-lg bg-brand px-4 py-2 font-semibold text-white">Try again</button>
          <a href="/dashboard" className="rounded-lg border border-line-strong px-4 py-2 font-semibold">Dashboard</a>
        </div>
      </div>
    </main>
  );
}
