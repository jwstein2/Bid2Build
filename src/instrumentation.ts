import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring/sentry-options";

export function register() {
  if (!sentryOptions.enabled) return;
  // The same options work in both the Node.js and Edge runtimes.
  Sentry.init(sentryOptions);
}

/** Reports errors thrown in server components, route handlers and server actions. */
export const onRequestError = Sentry.captureRequestError;
