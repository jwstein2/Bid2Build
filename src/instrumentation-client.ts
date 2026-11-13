import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring/sentry-options";

if (sentryOptions.enabled) {
  Sentry.init({
    ...sentryOptions,
    // Browser noise that is not our bug.
    ignoreErrors: ["ResizeObserver loop limit exceeded", "ResizeObserver loop completed with undelivered notifications"],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
