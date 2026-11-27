# Academy Advanced Learning (V10.0)

Paid, subject-based Academy courses added to the existing Contractor Academy. It uses one Academy, one sign-in, one
Stripe account and one set of Stripe customers, with several entitlements on top. Free Classroom courses stay free.

## What customers see

- **Classroom → Advanced Learning** section, after the general courses and before the trade directory (`/academy/classroom`).
- `/academy/advanced` is the hub: open subjects, the three packages, and upcoming subjects (shown but never sold).
- `/academy/advanced/[subject]` is the subject page: outcomes, curriculum, a free preview lesson, and "Choose how you want to learn".
- `/academy/advanced/membership` lets customers view, cancel at period end, resume, or open the Stripe billing portal.
- Paid lessons live at the normal `/academy/courses/[course]/[lesson]` URLs. When a lesson is locked, the page shows the package picker instead of the lesson.

| Package | Stage 1 price | Covers |
|---|---|---|
| Learn one subject | $9.99/mo | One subject |
| Learn + expand (recommended) | $14.99/mo | The chosen subject plus its admin-configured partner |
| Academy All Access + Estimator | $29.99/mo | Every advanced subject plus **one** Individual Unlimited entitlement |

All Access does **not** include Team/Enterprise plans, extra seats, Enterprise reporting, separately billed add-ons,
payment processing or banking fees, or AI use beyond the Individual Unlimited limits.

## Architecture

| Piece | Where |
|---|---|
| Schema, RLS, functions | `supabase/migrations/20270303001000_academy_advanced.sql` |
| Subjects seed (generated) | `supabase/migrations/20270303002000_academy_advanced_subjects.sql` ← `scripts/academy/advanced/gen-seed.mts` ← `src/lib/academy/advanced/content/index.ts` |
| Paid lesson text + its seed | **Not in this repo** (it is public). `private/academy-advanced/` (gitignored); the owner's copy is in the project files. Customers only get it from the database, behind the paywall. |
| Pure plan logic (client-safe) | `src/lib/academy/advanced/plans.ts` |
| Switches | `src/lib/academy/advanced/flags.ts` |
| Quote → accept → Checkout / upgrade | `src/lib/academy/advanced/checkout.ts`, `src/app/api/academy/advanced/{quote,accept,manage}` |
| Webhook + reconcile mirror | `src/lib/academy/advanced/billing.ts`, called from `applySubscription()` and `/api/stripe/webhook` |
| Stripe price provisioning | `src/lib/academy/advanced/provision.ts` (admin button + `scripts/academy/advanced/provision.mts`) |
| Admin dashboard and controls | `/academy/manage/advanced` (Academy admins only) |
| Rollback | `docs/academy/rollback_20270303001000.sql` |

**Separation from Individual Unlimited.** Academy subscriptions carry `metadata.product_line = academy_advanced` and use
prices listed in `academy_adv_prices`. `applySubscription()` routes them to `academy_adv_memberships` and never writes them
to `public.subscriptions`, so an Academy package can't be mistaken for a software plan. The single software
entitlement comes from a new All Access branch in `user_entitlement()`, which sits after the Enterprise seat and the
personal Individual Unlimited checks. It returns `source = 'academy_all_access'` and ends when the membership ends.
The Individual Unlimited and Enterprise checkouts ignore Academy subscriptions and sessions. Individual Unlimited
checkout refuses anyone who already has All Access.

**Paywall.** The paywall is enforced on the server. The `academy_lessons` read policy and `academy_course_outline` use
`academy_lesson_readable_in()`, so an `advanced` lesson is readable only with that subject (or All Access, a grant,
or staff). The page never receives a locked lesson's body, and there is no CSS blur. The older
`academy_lesson_readable()` always returns false for `advanced`, so any older path without course context stays locked.

**Prices.** Prices live in Stripe. Each one is mapped in `academy_adv_prices` by (mode, plan, stage, interval), with a
guard that a monthly price equals its stage price. Nothing is hard-coded in source. Fixed product ids
(`prod_b2bAcademy…`) and lookup keys (`b2b_academy_{plan}_s{stage}_{interval}`) make provisioning idempotent.
Checkout re-verifies the Stripe price amount before it opens a session.

**Checkout flow.**
1. Choose → `academy_adv_quote()` creates a server quote. It is serialized per mode with an advisory lock, holds a
   founding slot for 35 minutes, and allows one open quote per person.
2. Review and confirm shows the price, terms and hold time.
3. Accept → the hold is extended to at least 31 minutes, and a Stripe Checkout session opens with idempotency key
   `academy-checkout-{quote}`, Stripe Tax and promo codes off.
4. The webhook mirrors the subscription and records the invoice, and the first paid invoice allocates the founding position.

- **Upgrades** (one → two subjects, or → All Access) update the existing subscription with
  `proration_behavior: always_invoice` and `payment_behavior: pending_if_incomplete`.
- **Individual Unlimited → All Access** starts a new Checkout. Once All Access is active, the webhook cancels the
  Individual Unlimited subscription with proration, and the unused days become a credit on the customer balance, so
  nobody pays twice. Annual Individual Unlimited isn't converted automatically: customers are asked to email
  support@built2bid.org. Enterprise is never touched.

**Webhook events used:** `checkout.session.completed`, `checkout.session.expired` (add this event to the endpoint),
`customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`,
`charge.dispute.created/closed`. Events that arrive out of order are ignored using `last_event_at`.

## Founding-member counting policy

- One shared count of **unique customers** across all three packages, per Stripe mode (test and live are separate).
- A customer becomes a founding member on their **first paid Academy invoice greater than $0**. The position is
  allocated under a lock, and each customer gets one position for life.
- Default basis is **lifetime**: everyone who ever paid counts, even after cancelling. Admins can switch to
  **active**, which counts only members whose membership is live.
- A customer is **not counted** if every paid Academy invoice was fully refunded, or if a dispute was lost. Winning the
  dispute restores them. Admins can also mark a member as duplicate, fraud, test or other, and can restore them.
- A **returning** customer keeps their original position and doesn't take a new slot.
- Complimentary grants, staff access and $0 invoices never count.
- **Grandfathering:** the membership keeps the Stripe price it started on. A stage change affects only new quotes. A
  member who cancels and comes back, or changes package, gets the price available at that time.
- **Stage changes are manual by default.** An admin approves the next stage in Manage → Advanced. The dashboard
  recommends advancing only when the current stage is full **and** the published library meets the next stage's
  lesson minimum (12/24/36/48/60). Automatic advancement needs both the admin setting and
  `ACADEMY_PRICE_AUTO_ADVANCE_ENABLED=on`. It never moves to a stage whose Stripe prices aren't mapped.

## Switches (all off by default)

| Netlify variable | Effect |
|---|---|
| `ACADEMY_ADVANCED_ENABLED=on` | The pages exist for everyone. "Show to everyone" in Manage → Advanced must also be on. Staff can always preview. |
| `ACADEMY_ADVANCED_BILLING_ENABLED=on` | Choose and checkout work. Without it, buttons say "Coming soon". |
| `ACADEMY_ADVANCED_BILLING_LIVE=true` | Also required with a live Stripe key, on top of `STRIPE_ALLOW_LIVE=true`. |
| `ACADEMY_PRICE_AUTO_ADVANCE_ENABLED=on` | Lets the "advance automatically" setting take effect. |
| `ACADEMY_ADVANCED_PROVISION_LIVE=true` | Lets the provision button create **live** products and prices. Owner approval required. |

## Deployment checklist

1. Run `20270303001000_academy_advanced.sql`, then `20270303002000_academy_advanced_subjects.sql`, then the private `academy_advanced_lessons_seed.sql` (from the project files), in the Supabase SQL Editor.
2. Academy admin: read and publish the two courses (Manage → Courses), marked "In review" because they are AI-drafted.
3. On a **preview deploy** (test key): Manage → Advanced → Stripe prices → dry run, then create test-mode products and prices.
4. Set `ACADEMY_ADVANCED_ENABLED=on` and `ACADEMY_ADVANCED_BILLING_ENABLED=on` on the preview. Test with Stripe test cards:
   new purchase, upgrade, Individual Unlimited → All Access conversion, cancel and resume, refund, failed payment.
5. Add `checkout.session.expired` to the Stripe webhook endpoint (optional, because quotes also expire on their own).
6. Check that the Stripe customer portal doesn't let customers switch between Academy products and Individual Unlimited.
7. Set the tax code on the three Academy products (Stripe → Product → Tax category). Built2Bid's existing products use the account default.
8. **Go-live only with owner approval:** create live products and prices, then set the live billing switches.

## Rollback

Turn the Netlify switches off first (that's instant). If the database must be reverted, cancel Academy subscriptions in
Stripe, then run `docs/academy/rollback_20270303001000.sql`. It restores the previous `user_entitlement`, the lesson
policy and the lesson functions, and hides advanced lessons. Billing tables are kept for accounting.

## School / program compatibility

`academy_edu_groups`, `academy_edu_group_members` and `academy_edu_assignments` exist as schema only, with no UI yet.
An active group with `grants_advanced` opens every advanced subject for its members, but never software.

## Why the paid lessons aren't in the repository

The GitHub repository is public, so anything committed is readable by anyone. The paywall protects lesson text in the
database, but it can't protect text that is published in git. Paid lesson sources therefore live in
`private/academy-advanced/lessons/*.ts` (gitignored). To regenerate the lesson seed, put those files back and run
`npx tsx scripts/academy/advanced/gen-seed.mts`. After the first seed, the database is the source of truth, and
Academy admins edit lessons in Manage → Courses. The content tests and browser checks run whenever the private files
are present. CI uses fixture lessons instead.
