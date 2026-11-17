import type { Instrumentation } from "next";
import { sentryOptions } from "@/lib/monitoring/sentry-options";

type SentryModule = typeof import("@sentry/nextjs");

// Sentry loads in the background instead of as a static import. Next.js waits for register() before a
// cold server instance answers its first request, and loading the Sentry SDK there added time to every
// cold start. Errors that happen while it is still loading wait for it (onRequestError below), so none
// are lost.
let sentry: Promise<SentryModule | null> | null = null;

function loadSentry(): Promise<SentryModule | null> {
  if (!sentryOptions.enabled) return Promise.resolve(null);
  sentry ??= import("@sentry/nextjs").then((Sentry) => {
    // The same options work in both the Node.js and Edge runtimes.
    Sentry.init(sentryOptions);
    return Sentry;
  }, () => null);
  return sentry;
}

export function register() {
  // Start loading, but don't block the first request on it.
  void loadSentry();
}

/** Reports errors thrown in server components, route handlers and server actions. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  const Sentry = await loadSentry();
  await Sentry?.captureRequestError(...args);
};
