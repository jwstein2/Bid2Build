"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort boundary for errors in the root layout. Must render its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, textAlign: "center", padding: "0 16px" }}>
        <main role="alert">
          <h1 style={{ fontSize: 28, fontWeight: 800 }}>Something went wrong</h1>
          <p style={{ color: "#4b5563" }}>Please try again. If it keeps happening, reload the page.</p>
          {error.digest && <p style={{ fontSize: 12, color: "#6b7280" }}>Reference: {error.digest}</p>}
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, background: "#0B2D4D", color: "#fff", border: 0, fontWeight: 600, cursor: "pointer" }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
