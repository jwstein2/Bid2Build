# Universal search and command center (V6.4)

One search box on every signed-in screen: the header field on desktop, a search icon on phones (full screen), and
Ctrl K / ⌘ K anywhere. It finds real records and offers safe shortcuts ("New bid", "Record payment", "P&L").

## What it searches

| Group | Records | Never shown |
| --- | --- | --- |
| Customers | name, company, email, phone, address | |
| Bids & estimates | bid name, estimate number, customer, address, city, trade, bid section and line item text | costs, margins |
| Projects | project name, project number, PM, sales rep, customer | |
| Tasks | task name, assignee, assigned person or sub | |
| Scope & change orders | trade scope text, change order title and customer notes | internal notes |
| Signed proposals | proposal number, version (v2), signer | |
| Invoices & payments | number, customer, job, memo, amount, check number | card / bank details, tokens |
| Bills & expenses | vendor, bill number, vendor invoice number, payee, amount | |
| People & subs | employees, crews, subcontractors, vendors | pay rates, TINs/EINs, W-9s, insurance files |
| Suppliers & items | supplier directory, saved items (SKU), assemblies | supplier account numbers, item costs |
| Photos & messages | photo caption and labels (AI labels marked "AI label"), message subject and recipient | message bodies, GPS |

Financial records come only from the book the user is in: the real book, or the practice (sandbox) book while
practice mode is on. Practice results carry a "Practice" chip and never mix with real ones.

## How results are ranked

Tiers, highest first. Boosts only reorder within a tier.

1. Exact number (estimate, project, invoice, bill, SKU)
2. Exact name
3. Name starts with the search
4. Every word in the name
5. Another field (email, phone, amount, address, scope text). The reason line names the field ("Phone match")
6. Related record (a matching customer's bids, projects, invoices, messages)
7. Similar spelling ("jhonson"), only when nothing matched properly

Boosts: the project you're looking at (+250), an intent word such as "invoice" or "sub" (+200), recently updated
(up to +25), recently opened (+20). Archived records drop (−150).

Words the app understands before searching: record types ("invoice", "bill", "sub", "supplier", "co 2"), statuses
("overdue", "unpaid", "draft", "signed", "won"), phone numbers and dollar amounts. Accounting words stay separate,
so "bill" means vendor bills and "invoice" means customer invoices.

## Security

* `search_universal` runs as the signed-in user (SECURITY INVOKER). Every row passes the table's own row-level
  security before it is counted, ranked or returned. Nothing is fetched and then hidden in the browser.
* Postgres won't use a trigram index for LIKE under RLS, so `search_text_ids` (SECURITY DEFINER) finds the
  matching ids through the indexes first. It returns ids only, only from the caller's own records and company,
  and the main query then reads those rows under full RLS.
* Owner admin results (accounts) come from `search_admin_accounts`, which refuses anyone who isn't an admin.
* Command actions open the normal review screen. Picking a suggestion never pays, emails, deletes or changes a
  subscription. Actions follow the user's role, plan and Financials permissions. Bank reconciliation shows
  "Coming soon".
* Recent searches and opened records are per user. A recent record is checked again through RLS every time it's
  shown and dropped when access is gone. Turning history off clears it.

## Speed

Measured on the test database with 5,000 extra customers and bids and 2,500 extra tasks (best of 3):

| Search | Time |
| --- | --- |
| johnson | 32 ms |
| jhonson (typo) | 26 ms |
| 1042 | 27 ms |
| bulk customer 4321 | 21 ms |
| electrical (500 matching tasks) | 121 ms |
| smith deck | 63 ms |
| SHG-30-BLK | 18 ms |

The dialog waits 180 ms after the last keystroke, cancels older requests, and caches answers until it closes. No AI
runs while typing.

## Files

* Migration: `supabase/migrations/20261220001000_universal_search.sql`
  (rollback: `docs/universal-search/rollback_20261220001000.sql`)
* Search logic: `src/lib/search/` (`query.ts` parses the words, `kinds.ts` labels and links, `actions.ts` commands,
  `server.ts` runs it)
* API: `/api/search`, `/api/search/recent`, `/api/search/history`
* UI: `src/components/search/` and the results page `src/app/(app)/search/page.tsx`
* Tests: `tests/universal-search.test.ts` (parsing, actions) and `tests/db/universal-search.test.ts` (the 30 cases
  against the real SQL). Seed: `scripts/universal-search/seed.mjs`

## Known gaps

* There is no general document store yet, so document search covers photos (captions and labels) only.
* The "150-scenario" demo data set isn't in the repo. Tests use the seeded world (38 trades, the Johnson kitchen
  project, Financials with a practice book, a rival company and a solo contractor).
* Bank reconciliation is "Coming soon" in the command list.
