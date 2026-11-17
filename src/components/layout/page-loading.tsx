/**
 * Instant placeholder shown by loading.tsx while a signed-in page renders on the server.
 * Without a loading boundary a click shows nothing until the whole page (and every database read)
 * is done; with one, Next.js swaps in this skeleton immediately and streams the real page in.
 * Pure server markup: no client JavaScript.
 */
export function PageLoading({ label = "Loading" }: { label?: string }) {
  // bg-line follows the Light/Dark/Black theme tokens (globals.css).
  const bar = "animate-pulse rounded-xl bg-line/70";
  return (
    <div className="mx-auto max-w-7xl space-y-6" role="status" aria-live="polite" aria-busy="true" data-testid="page-loading">
      <span className="sr-only">{label}…</span>
      <div className="space-y-2">
        <div className={`${bar} h-8 w-56`} />
        <div className={`${bar} h-4 w-40`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${bar} h-24`} />)}
      </div>
      <div className={`${bar} h-72`} />
    </div>
  );
}
