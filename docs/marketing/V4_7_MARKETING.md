# V4.7 Marketing website and product packaging

Homepage, pricing and upgrade prompts now describe what Built2Bid actually does in production, organized
around three pillars: **Win the Job**, **Run the Job**, **Grow the Business**. No Stripe, price, entitlement
or database change. No URL removed or redirected.

## Source of truth

`src/lib/marketing/catalog.ts` lists every marketable feature with: name, description, pillar, comparison
group, plan (core / Unlimited / Project Command Center / Enterprise), release status, production switch,
in-app destination and upgrade destination. The homepage pillars, the pricing comparison, the Project Command
Center card and the in-app upgrade notices all read from it.

- A feature shows as available only when `release: "live"` **and** its production switch is on
  (`NEXT_PUBLIC_PROJECT_SCHEDULING=on` for Project Command Center, `NEXT_PUBLIC_ESIGNATURES=on` for
  e-signatures). Otherwise every surface says **Coming soon**.
- Prices are not typed in the catalog; they come from `billing/plans.ts`, `pm/billing.ts` and
  `enterprise/pricing.ts`, the same modules the Stripe price checks use.
- `tests/marketing-catalog.test.ts` checks prices, Coming Soon handling, switch handling, that entitlements
  match the feature registry, that PM features are never shown as part of Unlimited, and the upgrade paths.
- To launch Customer Follow-ups (V4.6) or scheduled update emails: after they are deployed and verified,
  change their `release` to `"live"` in a reviewed PR. Nothing flips automatically.

Public product name: **Project Command Center** (matches the live Stripe product). "PM Hub" is not used.

## Audit: outdated claims found and fixed

| Where | Before | Now |
|---|---|---|
| Homepage "How it works" | "Four steps, no training, no project-management bloat." | Removed; replaced by the three pillars |
| Homepage hero | "Win More Bids. Look More Professional. Get Back to Building." (bids only) | "Win More Bids. Manage Every Job. Grow Your Business." with copy that only mentions scheduling when the PM switch is on |
| Homepage strip | Trade templates, proposals, autosave, profit | Links to the three pillars |
| Site meta description (also OG + manifest) | Bids and PDFs only | Adds e-signatures, pipeline and (when on) scheduling; keeps "3 free bids" |
| Pricing comparison | No pipeline, e-signatures, internal report or PM; "sales pipeline and analytics" shown as Enterprise-only although every plan has its own | 6 groups, every cell in words: Included / Add-on $4.99/mo / Included for 1 editor / Coming soon / Not included |
| Unlimited card | Omitted Saved Items and Internal Estimate Reports | Lists them |
| Pricing page | No Project Command Center at all | Add-on card with $4.99/mo or $49.99/yr, what it includes, what is coming, and the right next step per account |
| Enterprise card | No PM editor, no bid style | 1 PM editor included, extra $1.99/mo each "for licensed users"; company-wide bid style |
| In-app "Unlock Project Command Center" (Projects, Schedule Now, schedule editor) | Sent Free accounts to Subscription, where the add-on can't be bought on Free | Free: explains Unlimited is needed first and links to pricing. Unlimited: links straight to the add-on card |
| JSON-LD offers | Free + Unlimited only | Adds the PM add-on (when on) and Enterprise base |

Not changed, flagged for James:
- The welcome video ("Meet Built2Bid") still shows the old headline. Re-record when convenient.
- Enterprise checkout stays "Contact us" (ENTERPRISE_CHECKOUT_LIVE is not on in production).
- Renaming "Saved customers" to "Customers" belongs to the V4.6 thread.
- Marketing pages are light-only by design (the Light/Dark/Black toggle applies to the signed-in app).

## What each pillar shows

- **Win the Job** (core unless marked): trade builders, calculators, Saved Items & Pricing (Unlimited),
  branded proposals, e-signatures, sales pipeline, change orders. Screenshot: pipeline.
- **Run the Job** (Project Command Center): Schedule Now, Gantt timeline, company calendar and workload,
  staff/sub assignments, progress tracking. Screenshot: timeline.
- **Grow the Business**: sales analytics, Internal Estimate Report (Unlimited), customer progress updates
  (PCC), scheduled update emails (Coming soon), customer follow-ups (Coming soon), multi-user account
  (Enterprise). Screenshot: customer progress update.

Screenshots are real app screens rendered from the local mock with sample data (no customer data), cropped
to WebP (21-56 KB) and lazy-loaded with `next/image`, so the hero and its LCP are unchanged.

Customer updates copy is careful: they are built from progress the team records, previewed before
sharing, and sent from the contractor's own email. Nothing claims automatic sending, reply monitoring or
that Built2Bid knows work is physically complete.

## SEO

- URLs, canonicals, sitemap, robots, GA and Search Console verification untouched.
- Homepage `<title>` unchanged. Site description updated (above). Pricing description adds the add-on and Enterprise.
- New internal links: homepage pillar anchors (`/#win-the-job`, `/#run-the-job`, `/#grow-the-business`),
  `/pricing#project-command-center`, trade pages link to "Contractor project scheduling" and "Compare plans".
- `#how-it-works` still exists (it's linked from every page's "See How It Works").

## Tests

- `npm test`: all unit tests pass, including the new `tests/marketing-catalog.test.ts`.
- `node scripts/marketing/v47-walk.mjs <out>`: 302/302 browser checks against a production build (switches on)
  and the mock Supabase: headline, CTAs and where they go, pillar order and badges, Coming Soon labels, prices,
  comparison cells, PM action per account (signed out, Free, Unlimited), in-app upgrade notices, billing anchor,
  every internal link and anchor on `/`, `/pricing`, `/bids/roofing`, SEO tags and JSON-LD, no horizontal scroll at
  1440/390/320, images load lazily with alt text, axe WCAG 2 A/AA = 0 on home and pricing. No Stripe call is made.
- `scripts/account-ctas/run.mjs`: 234/236. The 2 failures are the roofing landing page CTA "Create a Free Roofing
  Bid" from the growth landing pages (PR #62), not from this change; the homepage expectations were updated.

## Production approval checklist

1. Review the screenshots in `/mnt/project-files/marketing-v47/screenshots/` and the deploy preview.
2. Confirm the copy, especially "Win More Bids. Manage Every Job. Grow Your Business." and the Run the Job price note.
3. Merge. Production already has `NEXT_PUBLIC_PROJECT_SCHEDULING=on` and `NEXT_PUBLIC_ESIGNATURES=on`, so those
   features show as available. No env change, SQL or Stripe change is needed.
4. After deploy: open built2bid.org and /pricing, check the Run the Job price note and that Customer Follow-ups
   say Coming soon.
5. When V4.6 ships and is verified: set `release: "live"` for `nurture` / `scheduled_updates` in the catalog.
