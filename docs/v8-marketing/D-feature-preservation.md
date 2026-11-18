# D. Feature preservation audit

Rule: simplify the experience, not the product. Every change below was checked against what an authorized user could reach before.

| Change | What a user could do before | After | Still reachable? |
|---|---|---|---|
| Hero secondary CTA | Jump to Project Command Center section | Jump to sample proposal | Yes: "Run the Job" pillar link sits directly under the hero; PCC pricing link unchanged |
| Coming-soon items off homepage pillars | Read about unreleased items on the homepage | Read them on `/pricing#compare` | Yes (and they were never usable) |
| Visitor welcome popup | Auto-opened on marketing pages | Opens from Watch Demo / help menu; auto-opens once on the dashboard for new accounts | Yes: every step, the video and Create My First Bid unchanged |
| Header Upgrade link | Always shown to free users | Shown at 1 or 0 free bids | Yes: `/pricing`, plan cards, "Go Unlimited" in the credits card at 0, premium panels, out-of-credits dialog |
| What's New per-feature Upgrade button | Button per locked feature (wrong plan for add-on features) | One plan note per release with the correct destination | Yes, and now correct |
| Quick-start "See a finished sample proposal" link | Link inside the picker | Same link as the hero's secondary button | Yes |
| Old tagline / H1 | – | New copy | n/a |

Protected surfaces confirmed unchanged by walks: estimate builder, trade picker and `/start/[trade]`, checkout resume (20 scenarios), account-aware CTAs (236 checks), pricing packaging and comparison table, PCC pricing card, Enterprise card, onboarding tour content (125 checks), pillar screenshots.

Not changed at all: Stripe prices and ids (`plans.ts`, `enterprise/pricing.ts`), entitlements and RLS, emails, the database.
