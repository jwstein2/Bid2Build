import { sentryOptions } from "@/lib/monitoring/sentry-options";

/**
 * Sends a handled server error (one that was caught and logged with logError, so Next.js never sees it) to
 * Sentry. Off unless NEXT_PUBLIC_SENTRY_DSN is set. The SDK is initialized by src/instrumentation.ts; its client
 * lives on a global carrier, so this dynamic import reuses it. Only the scope, error code and the caller's id-only
 * metadata are sent, with email addresses masked, and each scope is capped per instance so one bad loop can't burn
 * the free 5k-events plan.
 */
const WINDOW_MS = 60_000;
const PER_SCOPE = 10;
const hits = new Map<string, { at: number; n: number }>();

export const maskEmails = (s: string) => s.replace(/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi, "[email]");

export function reportHandledError(scope: string, message: string | undefined, code: string | undefined, meta: Record<string, unknown>): void {
  if (!sentryOptions.enabled) return;
  const now = Date.now();
  const h = hits.get(scope);
  if (h && now - h.at < WINDOW_MS) { if (++h.n > PER_SCOPE) return; } else hits.set(scope, { at: now, n: 1 });
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.captureMessage(`${scope}: ${code ?? "error"}`, {
      level: "error",
      tags: { scope, area: scope.split(".")[0], code: code ?? "none" },
      extra: { message: maskEmails(message ?? "").slice(0, 300), ...meta },
      fingerprint: [scope, code ?? "none"],
    });
  }, () => {});
}
