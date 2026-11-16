/**
 * Browser Sentry, loaded on demand. The SDK is ~80 KB gzipped, which used to ship in every page's
 * first-load JavaScript (and even when the DSN is unset). Now:
 *  - DSN unset: the SDK is never downloaded.
 *  - DSN set: it loads in its own chunk once the page is idle (or immediately when an error needs
 *    reporting). Errors thrown before it arrives are buffered and sent when it does.
 * Same options as before: errors only, no tracing, no replay, no PII (see sentry-options.ts).
 */
import { sentryOptions } from "./sentry-options";

type SentryModule = typeof import("@sentry/nextjs");

let loading: Promise<SentryModule> | null = null;

export function loadSentry(): Promise<SentryModule> | null {
  if (!sentryOptions.enabled || typeof window === "undefined") return null;
  loading ??= import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      ...sentryOptions,
      // Browser noise that is not our bug.
      ignoreErrors: ["ResizeObserver loop limit exceeded", "ResizeObserver loop completed with undelivered notifications"],
    });
    return Sentry;
  });
  return loading;
}

/** Report an error caught by an error boundary (loads the SDK first if needed). */
export function reportError(error: unknown) {
  void loadSentry()?.then((Sentry) => Sentry.captureException(error)).catch(() => {});
}

/**
 * Called once from instrumentation-client: catch uncaught errors from the very start, and load the
 * SDK when the browser is idle so it never competes with the first paint.
 */
export function startSentry() {
  if (!sentryOptions.enabled || typeof window === "undefined") return;
  const early: unknown[] = [];
  const onError = (e: ErrorEvent) => early.push(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => early.push(e.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const load = () => {
    void loadSentry()?.then((Sentry) => {
      // Sentry's own handlers take over from here.
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      for (const err of early.splice(0)) Sentry.captureException(err);
    }).catch(() => {});
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(load, { timeout: 4000 });
  else setTimeout(load, 2000);
}
