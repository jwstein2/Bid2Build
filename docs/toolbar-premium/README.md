# Duplicate Selected + Unlimited feature indicators

## Selection toolbar (estimate builder)
- **Duplicate Selected** replaces "Use estimate pricing". Each selected row is copied directly below its original in the same section, with every field kept (name, description, type, quantity, unit, cost, pricing override, visibility, notes) and a new id, so it saves as its own row. A quantity calculation on the original is copied to the new row. Example rows are skipped. Confirms with "N items duplicated." and clears the selection.
- **Remove Override** (the old button's job) now lives in a ⋯ menu next to Apply, shown only when a selected row has its own markup/margin. Confirms with "Pricing override removed." Rows return to the section's pricing if it has one, otherwise the estimate's.
- **Save Item** when one row is selected, **Save Stack** for several. Both use the existing premium check; free accounts get the Unlimited upgrade dialog.

## Unlimited indicators and gating
- A small diamond (lucide `Gem`) marks **Saved Items & Pricing** and **Proposal Templates** in the sidebar (also in the mobile menu and current-page label), on their dashboard cards and page titles. Hover/screen readers: "Unlimited feature".
- Dashboard: Saved Items and Proposal Templates cards side by side. Free accounts see the approved one-line pitch and "See Unlimited plans".
- Free accounts opening either page see the shared upgrade panel (`components/billing/premium.tsx`): what it does, both plans ($19.99/month, $149/year) through the existing Stripe checkout, and Not now.
- One entitlement check, `hasPremiumAccess()` (`lib/billing/entitlement.ts`), wraps the database's `library_access()` (Unlimited in good standing or admin). Used by the library API, templates page and save action, dashboard, `/api/business` and new-bid start.

## Server-side enforcement
- Saved Items / Stacks: unchanged RLS from `20261114001000_saved_items_library.sql`.
- Proposal Templates: `PUT /api/business` used to accept `defaultProposalConfig` with no plan check; it is now ignored without access. New bids only start from saved defaults while the account has access.
- Migration `20261114003000_proposal_defaults_premium.sql`: a trigger keeps `business_profiles.default_proposal_config` unchanged when an account without access tries to set it. Company profile saves are unaffected; nothing is deleted on downgrade, and saved defaults apply again on reactivation.

## Tests
- `tests/duplicate-selected.test.ts`: duplication order, ids, field copy, pricing totals, calculator copy, Remove Override.
- `tests/db/proposal-defaults-premium.test.ts`: free/Unlimited/lapsed/reactivated/service-role behavior of the trigger.
- `scripts/toolbar-premium/walk.mjs`: 168 browser checks (desktop, tablet, 390, 320; free and Unlimited).
