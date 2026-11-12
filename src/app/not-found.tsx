import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-[70vh] place-items-center px-4 text-center">
      <div>
        <p className="text-sm font-semibold text-accent-dark">404</p>
        <h1 className="mt-1 text-3xl font-extrabold">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-ink-soft">It may have moved, or the link may be wrong.</p>
        <div className="mt-5 flex justify-center gap-3">
          <Link href="/" className="rounded-lg bg-brand px-4 py-2 font-semibold text-white">Home</Link>
          <Link href="/bids" className="rounded-lg border border-line-strong px-4 py-2 font-semibold">Start a bid</Link>
        </div>
      </div>
    </main>
  );
}
