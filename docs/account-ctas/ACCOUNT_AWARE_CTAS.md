# Account-aware CTAs and messaging

Every call to action, promo line and nav label on the public site now reflects the visitor's account state.

## How state is determined
- `src/lib/account/server.ts` → `getAccountContext()`: verified Supabase session (`auth.getUser()`) + the `credit_status` RPC, whose `unlimited` flag comes from `has_unlimited()` over the Stripe-synced `subscriptions` table. Cached per request (React `cache`) so header, page and footer share one lookup.
- `src/lib/account/status.ts` (pure, unit-tested): `accountStatusFrom()` → `signed_out | free | unlimited | no_credits`; `accountCtas()` → primary/secondary labels + links; `creditBadge()`.
- No localStorage, no manual roles. Entitlement enforcement is unchanged (Postgres `finalize_bid`).
- Rendered on the server, so the first HTML already has the right CTAs: no flash of free-bid copy while auth loads.
- Signed in but balance unknown (RPC error, unverified email): treated as a Free member without a number. Never shows signed-out promos or a false "out of credits".

## CTA matrix
| State | Primary | Secondary | Balance |
|---|---|---|---|
| Signed out | Create a Free Bid → /bids | See How It Works → /#how-it-works | – |
| Free, credits left (starter or monthly) | Create New Bid → /bids | View My Bids → /dashboard | "N free bids left" |
| Unlimited (incl. canceled-but-paid-through, past_due retry) | Create New Bid | View My Bids | none |
| No credits (incl. expired subscription with 0 credits) | View Plans → /pricing | View My Bids | "No free bids left" |

"View Plans" rather than "Get More Credits", because credits can't be bought; the only upgrade is Unlimited.

## Components updated
- Header (desktop + mobile menu): primary CTA by state, "My Bids" for signed-in, credit badge (lg+ / in menu).
- Homepage: hero tagline ("Professional estimates. Customer-ready proposals." for customers), hero CTAs, hero checklist, closing plan band (per-state copy), FAQ hides visitor-only questions for signed-in users and free-credit FAQ for Unlimited.
- Footer: free-offer sentence only for visitors.
- Pricing: per-state intro, Free card action, a "Your plan" badge on the right card (monthly vs annual from the subscription).
- Trade landing pages (38): hero + closing CTAs, note under CTA; zero-credit users keep a "Start a Draft" button.
- Learn articles: CTA box (also fixes outdated "Three finished bids every month" copy).
- Dashboard + app sidebar: "Create New Bid". Billing: "Your Unlimited plan has ended" notice for expired subscriptions (renews/cancels-on status was already shown).
- Unchanged by design: SEO meta descriptions/JSON-LD (public), sign-up dialog copy (signed-out only), pricing math, credits, Stripe.

## Testing
- `tests/account-status.test.ts`: 8 unit tests over every state.
- `scripts/account-ctas/run.mjs`: 236 browser checks, 7 scenarios × home/pricing/trade/learn/dashboard/billing × desktop 1440 + mobile 390, click-through destinations, slow auth (2s) + refresh. Mock Supabase scenarios switch at runtime: `GET :54321/__scenario?name=starter|monthly|unlimited|canceling|expired|zero&authDelayMs=N`.
- Screenshots: /mnt/project-files/account-ctas/screenshots/ (`<scenario>__<page>__<viewport>.png`).
