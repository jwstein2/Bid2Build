import { startSentry } from "@/lib/monitoring/sentry-client";

// Error reporting loads on demand (see sentry-client.ts) so the SDK stays out of first-load JS.
// Tracing is off (tracesSampleRate 0), so no router-transition hook is needed.
startSentry();
