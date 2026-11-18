/**
 * Demo / Practice session facts shared by the proxy (edge), server code and tests. No I/O here.
 *
 * A demo session is a normal Supabase session for a demo login. The login's app_metadata.b2b_demo is
 * written only by the server with the service key (users can't change app_metadata), so it is a
 * trustworthy, zero-cost signal in the JWT. Authorization never depends on it alone: the database
 * guards check public.demo_workspaces, and every demo record belongs to the demo login's own tenant.
 */
export type DemoSessionKind = "owner_demo" | "practice";
export interface DemoClaim { kind: DemoSessionKind; owner: string; workspace: string }

export const DEMO_META_KEY = "b2b_demo";
/** httpOnly cookie that holds the real session's refresh token while a demo session is active. */
export const DEMO_RETURN_COOKIE = "b2b-demo-return";
export const DEMO_RETURN_MAX_AGE = 60 * 60 * 12;
/**
 * Readable display hint ("owner_demo" | "practice") so pages outside the signed-in layout (the estimate
 * builder, trade picker, start pages) can show the DEMO MODE bar too. Display only: the client confirms
 * it with the server before showing anything, and no permission ever depends on it.
 */
export const DEMO_HINT_COOKIE = "b2b-demo-hint";
export function readDemoHint(cookie: string | null | undefined): DemoSessionKind | null {
  const v = (cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${DEMO_HINT_COOKIE}=`))?.slice(DEMO_HINT_COOKIE.length + 1);
  return v === "owner_demo" || v === "practice" ? v : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDemoClaim(appMetadata: unknown): DemoClaim | null {
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const raw = (appMetadata as Record<string, unknown>)[DEMO_META_KEY];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if ((r.kind !== "owner_demo" && r.kind !== "practice") || typeof r.owner !== "string" || !UUID.test(r.owner) || typeof r.workspace !== "string" || !UUID.test(r.workspace)) return null;
  return { kind: r.kind, owner: r.owner, workspace: r.workspace };
}

/**
 * API routes a demo or practice session may never call: anything that charges money, changes billing,
 * reaches a real person (email, SMS, signature requests, invitations, customer reports) or an outside
 * system (bank links, website import). The proxy answers 403 demo_blocked before the route runs.
 * `write` = only non-GET requests are blocked (reading the page's data stays allowed).
 */
export const DEMO_BLOCKED: readonly { prefix: string; write?: boolean }[] = [
  { prefix: "/api/stripe/checkout" },
  { prefix: "/api/stripe/enterprise-checkout" },
  { prefix: "/api/stripe/portal" },
  { prefix: "/api/billing/" },
  { prefix: "/api/company/seats", write: true },
  { prefix: "/api/company/pm-editors", write: true },
  { prefix: "/api/company/invitations", write: true },
  { prefix: "/api/account/delete" },
  { prefix: "/api/account/marketing", write: true },
  { prefix: "/api/account/market-consent", write: true },
  { prefix: "/api/account/ad-consent", write: true },
  { prefix: "/api/estimates/", write: true, /* signing + countersign only, see matcher */ },
  { prefix: "/api/financials/email", write: true },
  { prefix: "/api/financials/tax-banking", write: true },
  { prefix: "/api/comms/", write: true },
  { prefix: "/api/comms", write: true },
  { prefix: "/api/schedules/", write: true /* customer updates only, see matcher */ },
  { prefix: "/api/scope/", write: true /* share only, see matcher */ },
  { prefix: "/api/bid-check/invite" },
  { prefix: "/api/trial/" },
  { prefix: "/api/import-website" },
  { prefix: "/api/onboarding/branding", write: true },
  { prefix: "/api/onboarding/discover", write: true },
  { prefix: "/api/team/supplier-pricing/connections", write: true },
  { prefix: "/api/auth/phone-abandon" },
];

/** Paths under a broad prefix that are blocked; the rest of that prefix stays usable in a demo. */
const NARROW: Record<string, RegExp> = {
  "/api/estimates/": /^\/api\/estimates\/[^/]+\/(signing|countersign)(\/|$)/,
  "/api/schedules/": /^\/api\/schedules\/[^/]+\/updates(\/|$)/,
  "/api/scope/": /^\/api\/scope\/[^/]+\/share(\/|$)/,
  "/api/comms/": /^\/api\/comms\/(?!settings$|preview$)/,
  "/api/comms": /^\/api\/comms$/,
};

export function isDemoBlocked(pathname: string, method: string): boolean {
  const write = method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD";
  for (const b of DEMO_BLOCKED) {
    if (b.prefix.endsWith("/") ? !pathname.startsWith(b.prefix) : !(pathname === b.prefix || pathname.startsWith(`${b.prefix}/`))) continue;
    if (b.write && !write) continue;
    const narrow = NARROW[b.prefix];
    if (narrow && !narrow.test(pathname)) continue;
    return true;
  }
  return false;
}

export const DEMO_BLOCKED_MESSAGE = "This action is turned off in Demo Mode, so nothing reaches real customers, payments or billing.";
