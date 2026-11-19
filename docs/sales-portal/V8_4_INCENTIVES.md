# Sales Hub V8.4 P0: accelerators, personal records, Recognition & Incentives

Migration `20270116001000_sales_v84_accelerators.sql`, rollback in `supabase/rollback/`.

## Monthly accelerators

| New paid sales in the month (Central time) | Bonus on that month's sale commissions |
|---|---|
| 1-4 | 0% |
| 5-9 | +5% |
| 10-14 | +10% |
| 15-19 | +15% |
| 20+ | +20% |

Example: 10 sales whose sale-month commissions total $199.90, so 10% gives $19.99 and $219.89 in all.

* **Off by default.** Rates and the on/off switch live on Admin Sales Hub → Recognition & incentives and
  are part of the versioned policy (owner only). Turning it on pays from that month onward
  (`accelerator_active_from`), never earlier months. While off, the admin table previews what would pay.
* **Qualifying sale:** a sale-month (`year_no = 1`) commission line that isn't canceled, ineligible or
  reversed. Anniversaries, unpaid sign-ups and complimentary grants have no such line, so they never count.
  The base rate is never changed.
* **When it's fixed:** after the month ends and every qualifying sale has cleared its 30-day refund hold.
  A sale refunded or canceled inside the hold doesn't count (recorded as a refund adjustment). A finalized
  month is never recalculated.
* **Ledger:** `sales_accelerators` holds one row per rep and month: qualifying line ids, counts, base,
  rate, bonus, refund adjustments, policy version, tiers used, status. The bonus is split across the
  month's sales with largest-remainder rounding, so the parts add up exactly. Each part is an `accelerator`
  commission line (`earned`, current month). The unique index on (customer, year, kind) makes re-runs and
  retries safe. Lines go through the existing statement approval and manual payout recording.
* The nightly `sales-close` cron runs `sales_accelerators_evaluate` and `sales_achievements_evaluate`.

## Personal records (replaces the Bronze-Diamond rank, James 2026-11-19)

Quests and XP stay. "You vs. your best month" compares this month's XP only with the rep's own best
earlier month, and a personal records card does the same for paid accounts, follow-ups and meetings.
A rep's first month sets a baseline instead of showing a record. There are no tiers or rankings
between reps.

`sales_achievements` holds one row per rep, kind and month, so a celebration never duplicates:
first sale, first sale of the month, record month (paid accounts, follow-ups), accelerator tier. No cash
is attached.

## Recognition & incentives (admin)

* Incentive cost against collected revenue for the last 6 months: base commissions, accelerators and
  milestone boxes, as a percentage of revenue (before tax, net of refunds).
* Accelerator ledger with status (open, in hold, earned, approved, paid).
* Achievements with "Mark congratulated" and a link to the rep.
* Upcoming milestones, mystery box awards and recent sales.

The congratulation email, preferences survey, reward catalog and calendar are V8.4 P1-P2.

## P1: preferences, celebrations, congratulations and rewards

Migration `20270117001000_sales_v84_recognition.sql`, rollback in `supabase/rollback/`.

### Work preferences (`/sales/preferences`)
* 20 optional questions (`src/lib/sales/preferences.ts`), written for Built2Bid around common workplace
  motivation ideas (autonomy, competence, relatedness, goal setting, recognition preferences). Not copied
  from any published instrument, not validated, not a psychological or suitability assessment.
* Nothing sensitive is asked (no health, family, finances or protected traits). Save, Skip for now and
  Delete my answers. Skipping changes nothing about pay, leads or access.
* The rep sees a plain summary. No score, no type, no label.
* Choices: dashboard layout (recommended from question 1, or the rep's own pick), public recognition
  (off by default), owner congratulation emails (on unless turned off), share hobbies with admins, and
  celebration animations (the device's reduced-motion setting always wins).
* Admins see only recognition and reward answers (questions 3, 4, 11, 12, 15, 16, 17) and hobbies when
  shared (13, 14). Everything else stays with the rep. Answers are never used for pay or decisions.

### Personalized overview
The layout changes only the order of the overview sections (progress, earnings, customers, team). Every
section, including earnings, is always shown.

### Customer success celebrations
Checked nightly by `sales_customer_successes_evaluate` (sales-close cron) for attributed, paying customers:
* First real estimate: 3+ line items with a name, quantity and price (the growth activation rule).
* First proposal: a signing link created or a PDF exported.
* Activated: Built2Bid's 7-day activation rule.
* Onboarding complete: a real estimate and a proposal.

Opening a tutorial or finishing the tour doesn't count. Each customer and kind is recorded once. The rep
sees a one-time celebration (a small pop and a few sparks, no confetti), then the history.

### Owner congratulations email
* Off by default. The owner turns it on and edits the default message (spec text, `{first_name}`).
* Each completed onboarding creates one draft (unique per success). The owner edits, then sends it from
  the verified founder address (`FOUNDER_EMAIL_FROM`, default james@built2bid.org) through Resend. The
  provider idempotency key is the draft id, so a double click or retry can't send twice.
* A rep who turned emails off is skipped, including drafts already waiting.

### Reward catalog and awards (`/sales/rewards`)
* Owner-only catalog: name, description, category, eligibility, value, cost, delivery method, tax
  treatment, status. Cash is always taxable cash; gift cards are always cash equivalents.
* Sales Admins propose awards (never for themselves); the owner authorizes, marks ordered and delivered,
  or cancels. One live award per customer success or achievement.
* Only an authorized cash reward touches money: one earned `reward` ledger line on the next statement,
  through the normal approval. Gift cards and prizes are bought and sent by hand. Nothing is purchased
  automatically.

### Not in P1
Weekly recognition digest email and immediate milestone notifications (P3), the "My Business" portfolio
page (P3), calendar and scheduling (P2).

## P3: My Business, voluntary goals, team wins and the owner's digest

Migration `20270119001001_sales_v84_business.sql` (rollback in `supabase/rollback/`).

- **My Business** (`/sales/business`): the rep's own customer portfolio. It shows customers, sales by month, upcoming
  anniversaries (contingent on the customer staying subscribed), suggested check-ins, and an illustrative "what if"
  calculator that is clearly labeled as an illustration, not a promise. It closes with a short "How we work" section
  that sets expectations in plain language.
- **Goals are voluntary.** A rep may set monthly targets for new sales, onboardings, follow-ups, prospects contacted or
  earnings. Goals are never required, never ranked, never shown to other reps, and never used for pay, leads or any
  decision about the rep. Last month's actuals appear as a reference point only.
- **Team wins** (overview "Team" section): first names and what happened (onboarding complete, first sale, record
  month) over the last 14 days, only for reps who turned on public recognition in My preferences. No amounts, no ranking.
- **Owner's weekly digest**: off by default. When the owner turns it on in Admin, Recognition, the daily sales cron
  sends one email per week (Monday or later, Central time) to the owner only, summarizing sales, customer successes,
  achievements and anything awaiting the owner. `SALES_DIGEST_TO` overrides the recipient; otherwise it goes to the
  founder address. A preview is on the same admin card.
- Known approximation: My Business matches onboarding successes to customers by company name.
