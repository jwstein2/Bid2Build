# Financial Command Center: Pricing and Unit Economics (Phase 0)

Owner: Agent 3 (Payments and Application Integration)
Date: 2026-11-17
Proposal under review: **$24.99/month base, including 3 financial users, plus $4.99/month per extra financial user**

**Verdict: GO WITH CHANGES** (section 9).

Labels used below: **Verified** means read from an official source in this session. **Secondary** means the official page could not be reached from this session (stripe.com, intuit.com, plaid.com and supabase.com/pricing are outside its network allowlist), so the figure comes from search snippets or third-party summaries and must be confirmed. **Estimate** means my own assumption, stated so it can be changed.

---

## 1. How Built2Bid bills add-ons and seats today (repo inspection, read-only)

| Item | Where | Mechanism |
|---|---|---|
| Standard Unlimited $19.99/mo, $149/yr | `src/lib/billing/plans.ts` | One price per plan from env (`STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL`). The server checks the price's amount, currency and interval against the code table before Checkout (`priceMismatch`). |
| Enterprise $49.99 base (3 users) plus seats | `src/lib/enterprise/pricing.ts` | One subscription with two items: a flat base price (qty 1) and a **graduated tiered** seat price with qty = users − 3. Tiers: users 4–5 at $19.99, 6–10 at $17.99, 11+ at $15.99. **Monthly only** (`recurringMonthly` rejects other intervals). |
| PM add-on $4.99/mo or $49.99/yr (Standard); extra editors $1.99/mo (Enterprise) | `src/lib/pm/billing.ts`, `src/app/api/billing/pm-addon/route.ts`, `src/app/api/company/pm-editors/route.ts` | Added as an **item on the existing subscription**. The interval must match the plan's interval (a Stripe rule noted in code), so annual plans need the annual add-on price. Every price is verified against code constants (`verifyPmPrice`, cached 10 min). |
| Proration | the routes above | Preview with `invoices.createPreview` and a fixed `proration_date`. Adding uses `proration_behavior: "always_invoice"` and `payment_behavior: "error_if_incomplete"`. Removing the Standard add-on uses `"none"` (access until period end). Removing Enterprise seats or editors uses `"create_prorations"` (immediate credit). Requests carry idempotency keys. |
| Tax | `src/lib/billing/tax.ts` | Stripe Tax is on for Checkout (`automatic_tax`, billing address required). Previews mirror the subscription's tax setting. |
| Entitlement sync | `src/lib/billing/sync.ts`, `apply.ts`, migration `20261116003000_pm_entitlements.sql` | The webhook re-fetches the subscription and writes `apply_subscription_update`, then `apply_pm_update` for `pm_addon`, `pm_addon_until` and `pm_extra_editors`. Writes are ordered by event time. The `pm_entitlement()` and `my_pm_access()` RPCs gate the feature. Data is never deleted when an add-on ends; the schedule becomes read-only. |

### 1.1 How the Financial add-on should fit (design, not implemented)

**New Stripe prices (owner creates them; four price IDs):**

| Env var (proposed) | Price | Type |
|---|---|---|
| `STRIPE_PRICE_FIN_BASE_MONTHLY` | $24.99 / month, qty 1 | licensed, per unit |
| `STRIPE_PRICE_FIN_SEAT_MONTHLY` | $4.99 / month per extra financial user (qty = users − 3) | licensed, per unit (flat, not tiered) |
| `STRIPE_PRICE_FIN_BASE_ANNUAL` | $249 / year (suggested; section 9) | licensed |
| `STRIPE_PRICE_FIN_SEAT_ANNUAL` | $49.99 / year per extra user (suggested; same ratio as the PM add-on) | licensed |

Annual prices are needed only for Standard annual subscribers. Enterprise is monthly-only, so it uses only the monthly pair.

**Code touchpoints when this is built (for the implementing agent):**
- `src/lib/billing/sync.ts`: add a `finIds` set and exclude it, alongside `pmIds`, when picking the "plan item". Otherwise a Financial item could be mistaken for the plan and change `p_plan` or `p_price_id`. This is the highest-risk regression.
- `src/lib/billing/apply.ts`: add `apply_fin_update(p_stripe_subscription_id, p_fin_addon, p_fin_extra_users, p_event_created)`, modeled on `apply_pm_update`.
- New migration: `subscriptions.fin_addon`, `fin_addon_until`, `fin_extra_users`. Add a `fin_users` assignment table (like `pm_editors`), the `fin_entitlement()` and `my_fin_access()` RPCs, and complimentary-grant support (`complimentary_grants.fin_users`).
- New pure module `src/lib/financial/billing.ts`, mirroring `pm/billing.ts`, with constants `FIN_BASE_CENTS=2499`, `FIN_SEAT_CENTS=499`, `FIN_INCLUDED_USERS=3` and price-mismatch checks.
- Routes: `/api/billing/financial-addon` (preview, add, remove) and `/api/company/financial-users` (seat quantity), reusing the preview, `proration_date` and idempotency pattern.
- The founder-email and ad "list value" logic in the webhook (`listValueUsd`) will include the add-on automatically. Decide whether that is wanted.

**Proration (recommended, consistent with existing behavior):**
- Adding the add-on or extra users: `always_invoice` (charge the prorated amount now), previewed first.
- Removing the add-on: `proration_behavior: "none"`. Full access continues until `current_period_end`, then the data becomes **read-only**.
- Removing extra users: `create_prorations` (credit on the next invoice), blocked below the number of assigned financial users. This is the same as `checkEditorTarget`.

**Stripe Tax:** the Financial items join the existing subscription, which already has `automatic_tax` on, so tax is calculated on them automatically. Give the new Product the **same product tax code as the existing Unlimited product**, and have the owner confirm the code (gate P3).

**Cancellation and data retention (recommended policy):**
1. Add-on removed while the account remains: read-only access to all financial records **indefinitely**, with full export. No new invoices, bills or receipt extraction.
2. Whole subscription canceled: same read-only access and export for at least **12 months**. After that, records are archived (not deleted) and can be exported on request until the account is deleted. Deletion only happens on the user's request, after an export prompt.
3. Export formats: CSV for invoices, payments, bills, job cost and vendors; a ZIP of receipts and documents with a manifest; PDF invoices. Later, IIF or QBO-compatible CSV for accountants.
4. Rationale: tax records often need to be kept 3 to 7 years ([IRS](https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records)). Deleting a contractor's financial history because they stopped paying $24.99 would be a trust and legal risk. Storage per company is pennies (section 3).

**"Financial user" definition (a decision is needed):**
- Standard Unlimited is a single-login plan. "3 financial users" only makes sense if financial users can be **people who are not Unlimited licensees**, such as an office manager, bookkeeper or outside CPA, with a financial-only role.
- Enterprise: a financial user should be an active licensed member, like PM editors. Recommendation: in addition to the 3, **one free read-only "Accountant" seat** that does not count. It removes the main objection ("my CPA needs to see it") and costs almost nothing.

---

## 2. AI receipt extraction cost (Claude Haiku)

**Pricing (Verified, [platform.claude.com pricing](https://platform.claude.com/docs/en/about-claude/pricing)):**

| Model | Input / MTok | Output / MTok | Batch (50% off) |
|---|---|---|---|
| **Claude Haiku 5.5** (`claude-haiku-5-5`, prompts ≤100K tokens) | **$0.10** | **$0.50** | $0.05 / $0.25 |
| Claude Haiku 4.5 (fallback reference) | $1.00 | $5.00 | $0.50 / $2.50 |

The repo already uses `claude-haiku-5-5` as `DEFAULT_MODEL` with the same price table (`src/lib/ai/provider.ts`). US-only inference (`inference_geo`) adds a 1.1x multiplier (same source).

**Tokens per receipt.** An image costs `ceil(w/28) × ceil(h/28)` visual tokens. Haiku 5.5 is in the high-resolution tier (Claude 4.7 and later), with a long-edge maximum of 2,576 px and a maximum of **4,784 visual tokens** ([Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision), Verified). A 1 MP image costs about 1,296 tokens.

| Scenario | Input tokens | Output tokens | Cost / receipt (Haiku 5.5) |
|---|---|---|---|
| Phone photo at full resolution (capped at 4,784) + 800-token prompt and schema | about 5,600 | about 500 (JSON: vendor, date, totals, tax, line items, category) | **$0.00081** |
| Downsampled to about 1 MP before upload | about 2,100 | about 500 | **$0.00046** |

**Monthly AI cost per company** (with a 1.5x allowance for retries and multi-page PDFs):

| Receipts/month | Haiku 5.5, full resolution | Haiku 5.5, 1 MP | Haiku 4.5, full resolution (reference) |
|---|---|---|---|
| 20 | $0.02 | $0.01 | $0.24 |
| 60 | $0.07 | $0.04 | $0.73 |
| 200 | $0.24 | $0.14 | $2.43 |

**Takeaway:** AI cost is immaterial to the price, under 1% of revenue even at 200 receipts. The owner's preference for Haiku is well founded. Use structured outputs (JSON schema), downsample to about 1,500 px on the long edge, and send uploads as Batch requests where a few minutes' latency is acceptable. Keep a per-company monthly fair-use cap (for example 1,000 extractions) and the existing global `AI_MONTHLY_BUDGET_USD` guard as abuse protection, not as a cost driver.

---

## 3. Infrastructure and other costs

### 3.1 Supabase (Verified via Supabase docs)

| Item | Price | Source |
|---|---|---|
| Pro plan | $25/month, includes $10 compute credits (the repo's cost registry says the org is on Pro) | [Compute usage](https://supabase.com/docs/guides/platform/manage-your-usage/compute) |
| Compute | Micro about $10, **Small about $15**, Medium about $60, Large about $111 per month | same |
| File storage | 100 GB included, then **$0.0213/GB-month** | [Storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size) |
| Egress | 250 GB uncached + 250 GB cached included, then **$0.09/GB** uncached and $0.03/GB cached | [Egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress) |
| Daily backups | 7 days on Pro. **Storage objects are not included in database backups** | [Backups](https://supabase.com/docs/guides/platform/backups) |
| PITR | **about $100/month for 7 days** (requires Small compute or larger) | same |
| Database size overage | about $0.125/GB beyond 8 GB (Secondary) | third-party summaries |

**Per-company storage estimate (Estimate).** Receipts average 1.5 MB after compression, kept for about 12 months on average in the model, viewed about twice. At 60 receipts/month that is about 1.1 GB stored, about $0.02 storage and $0.02 egress. At 500 receipts/month it is about 9 GB stored, about $0.19 storage and $0.14 egress. Doubling for an off-site backup copy gives the "Storage/egress/backup" line used below: **$0.06 / $0.10 / $0.18 / $0.50** per month at 3, 5, 10 and 25 users. This is conservative because it ignores the included quotas.

**Audit log (Estimate).** About 2,000 events per company per month at about 1 KB each is about 24 MB per year per company. Across 200 companies that is about 4.8 GB per year, roughly $0.60/month total once past included database storage. Partition by month, keep 7 years, and move data older than 24 months to cold storage. **Negligible.**

**Backups (fixed).** Financial data justifies **PITR, about $100/month**, plus at least **Small compute (about $15/month)**. This is fixed platform cost, not per company. If PITR is already justified for the core product, the Financial add-on's incremental cost is $0. Off-site receipt backup (Storage is not in DB backups) costs about $5/month (Estimate).

### 3.2 Stripe fees on the add-on revenue (Secondary rates; confirm on stripe.com)

| Fee | Rate | Applied in model |
|---|---|---|
| Card processing | 2.9% + 30¢ | **2.9% only**, because the add-on is an item on the **same invoice** as the plan and the 30¢ is already paid. A separate subscription would add 30¢, which is +1.2% at $24.99. |
| Stripe Billing | 0.7% of billing volume (pay-as-you-go) | 0.7% |
| Stripe Tax | 0.5% per transaction where registered | 0.5%, conservatively on all revenue |
| **Total** | | **4.1% of add-on revenue** |

### 3.3 Bank feeds (if added later; not in the base model)

| Vendor | Cost (unverified) | Per-company impact |
|---|---|---|
| Stripe Financial Connections | Transactions possibly about $0.30 per account per month; balance about $0.10 per call; ownership about $1.50 per call (Secondary) | 2 accounts with transactions only: about $0.60/month. **Daily balance refreshes would add about $3 per account per month. Avoid them.** |
| Plaid | About $0.25 per account per month reported; possible monthly minimums (a third party cites $1,000/month; **unverified**) | A vendor minimum would wipe out margin below about 100 companies. This is the main reason to start with manual import. |

Recommendation: price bank feeds as a pass-through add-on, for example "+$5/month includes 2 bank connections" (Estimate), only after quotes are in hand.

### 3.4 Support and onboarding (Estimate)

- Year 1: 0.5 to 1 ticket per company per month for financial questions ("why doesn't this match my bank", "how do I handle a deposit"). At 15 to 20 minutes and a $40/hour loaded cost, that is **$5 (3 users), $6 (5), $8 (10), $12 (25)** per month.
- Steady state (after help docs, templates and in-app guidance): about 40% of year 1.
- Onboarding: a 1-hour assisted setup (import customers and vendors, opening balances) at $40, amortized over 12 months, is **$3.33/month**, year 1 only.
- Financial features generate **more and higher-stakes tickets** than estimating. Mistakes in money data hurt trust. Budget for written help content before launch.

### 3.5 Accounting and legal review (one-time, amortized; Estimate)

| Review | Range | Notes |
|---|---|---|
| CPA review, Phase 1 (invoices, payments, deposits and retainage, job costing, vendor bills, exports) | **$3,000–$8,000** (about 15–40 hours at $150–$250/hr) | Validates terminology, workflows and export formats accountants accept |
| CPA review, later double-entry GL, bank reconciliation, chart of accounts | **$5,000–$15,000** | Required before any "GL" or "books" claims |
| Legal (terms addendum, disclaimers, privacy updates, Connect terms) | $1,500–$4,000 | Overlaps payments gate G2 |

Amortizing **$5,000 (Phase 1 CPA) + $2,500 (legal) over 24 months is about $312/month**. Per paying company:

| Companies | Low ($3k CPA + $1.5k legal) | Mid ($5k + $2.5k) | High ($8k + $4k) |
|---|---|---|---|
| 10 | $18.75 | $31.25 | $50.00 |
| 50 | $3.75 | $6.25 | $10.00 |
| 200 | $0.94 | $1.56 | $2.50 |

The GL-phase review ($5k–$15k) is **not** in the base model. It should be funded by the later price step-up (section 9).

---

## 4. Per-company monthly margin (proposed price; year 1 and steady state)

Revenue = $24.99 + $4.99 × (users − 3). Receipts per month are assumed to scale with users: 60, 100, 200 and 500.

| Users | Price/mo | Stripe 4.1% | Haiku AI | Storage/egress/backup | Email/PDF | Support (yr 1) | Onboarding (yr 1) | **Variable cost** | **Contribution** | **Margin yr 1** | **Margin steady state** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | $24.99 | $1.02 | $0.09 | $0.06 | $0.10 | $5.00 | $3.33 | $9.60 | $15.39 | **62%** | **87%** |
| 5 | $34.97 | $1.43 | $0.15 | $0.10 | $0.15 | $6.00 | $3.33 | $11.16 | $23.81 | **68%** | **88%** |
| 10 | $59.92 | $2.46 | $0.30 | $0.18 | $0.25 | $8.00 | $3.33 | $14.52 | $45.40 | **76%** | **89%** |
| 25 | $134.77 | $5.53 | $0.75 | $0.50 | $0.50 | $12.00 | $3.33 | $22.61 | $112.16 | **83%** | **91%** |

AI uses $0.0015 per receipt (conservative). Email/PDF covers transactional email and invoice PDF generation (Estimate). Steady state assumes support at 40% of year 1 and no onboarding cost.

**Reading:** support time is the dominant cost, not infrastructure or AI. At 3 users, one extra 30-minute support call per month cuts year-1 margin from 62% to about 42%. The price is viable as long as support is productized.

## 5. Portfolio margin at 10, 50 and 200 paying companies (year 1)

Mix assumption (Estimate): 60% at 3 users, 25% at 5, 12% at 10, 3% at 25. Blended revenue is **$34.97 per company per month**, with blended variable cost of $10.97.

Fixed monthly costs attributable to the add-on: PITR $100 + Small compute $15 + off-site backup $5 + CPA and legal amortization $312 = **$432**. At 200 companies, Medium compute ($60) replaces Small: **$477**.

| Paying companies | MRR | Variable | Fixed | **Operating contribution** | **Margin** | Per company |
|---|---|---|---|---|---|---|
| 10 | $350 | $110 | $432 | **−$192** | −55% | −$19.20 |
| 50 | $1,748 | $549 | $432 | **$768** | 44% | $15.36 |
| 200 | $6,994 | $2,195 | $477 | **$4,322** | 62% | $21.61 |

- **Break-even is about 18 paying companies** in year 1 ($432 ÷ about $24 blended contribution). In steady state it is about 14.
- If PITR and compute are already needed for the core app, fixed cost falls to about $317 and break-even to about 13 companies.
- Engineering build cost (founder or agent time) is **not** included. This is contribution, not payback. Payback on a notional $20k build at 50 companies takes about 26 months; at 200 companies about 5 months (Estimate).

## 6. Sensitivity: alternative price points (monthly revenue by user count)

| Base / extra user | 3 users | 5 users | 10 users | 25 users |
|---|---|---|---|---|
| $19.99 / $4.99 | $19.99 | $29.97 | $54.92 | $129.77 |
| **$24.99 / $4.99 (proposed)** | **$24.99** | **$34.97** | **$59.92** | **$134.77** |
| $29.99 / $5.99 | $29.99 | $41.97 | $71.92 | $161.77 |
| $39.99 / $7.99 (post-GL candidate) | $39.99 | $55.97 | $95.92 | $215.77 |

---

## 7. Market comparison (public list prices; all Secondary, so confirm before publishing)

| Product | Price | Users | Notes |
|---|---|---|---|
| QuickBooks Online Simple Start | about $38/mo | 1 | After an Aug 2026 increase per several sources; earlier 2026 figures were lower |
| QBO Essentials | about $85/mo (some sources $75) | 3 | Conflicting sources |
| QBO Plus | about $140/mo | 5 | Job/project profitability |
| QBO Advanced | about $340/mo | 25 | |
| JobTread | $199/mo first user + $20/user monthly; annual about $159 + $16–18/user | per user | All features; free customer and vendor portal users |
| Buildertrend | Not published (quote only). Last published (late 2024): Essential $499/mo month-to-month ($449 annual), Advanced $799, Complete $1,099. 2026 estimates range $339–$1,099 | unlimited | Financial tools in higher tiers; onboarding fees reported |
| Contractor Foreman | from about $49/mo (Basic, annual); higher tiers conflict across sources | varies | Says it has no per-user fees on some plans |
| Knowify | Core about $99/mo (+ about $10/user reported); Advanced $149–$329 (conflicting) | varies | QuickBooks-centric job costing |
| **Built2Bid Standard + Financial** | **$19.99 + $24.99 = $44.98/mo** | 3 financial users | Estimating, proposals and financials |
| **Built2Bid Enterprise (3) + Financial** | **$49.99 + $24.99 = $74.98/mo** | 3 licensed + 3 financial | |

**Positioning:** the price is far below JobTread or Buildertrend for a 3-to-5-person contractor, and below QBO Essentials. The danger is not being too expensive. It is (a) being compared with QBO as a **replacement** before the GL exists, and (b) being underpriced relative to the value once the GL and bank reconciliation ship.

---

## 8. Risks

1. **Price anchoring against QBO.** Contractors' CPAs mostly require QBO. If Financial is marketed as accounting, customers will ask "why not just QBO for $38?" Mitigation: position Phase 1 as **job financials and getting paid**, with "Export to your accountant / QuickBooks" as a feature, not a replacement.
2. **Being seen as accounting software of record before validation.** Any "books", "GL", "tax-ready" or "reconciled" wording before CPA review (gate P5) creates liability and support risk. Use "records" and "job cost tracking" until then.
3. **Support load.** Money questions are urgent and emotional. Support is the dominant cost (section 4). Mitigation: in-app guided setup, templates, a "why doesn't this match" explainer, and support SLA language.
4. **Seat definition confusion** on single-login Standard plans (section 1.1). Mitigation: a financial-only role plus a free Accountant seat.
5. **Annual-interval mismatch.** Stripe requires all items on a subscription to share one interval, so annual Standard customers need annual Financial prices at launch, or they can't buy it. This is the same issue PM hit (`annual_unavailable`).
6. **Low ARPU at 3 users** makes the add-on sensitive to churn and support. 10 paying companies lose money in year 1.
7. **Bank-feed vendor minimums** could break the economics. Mitigation: manual import first and pass-through pricing.
8. **Grandfathering debt.** Launching low and raising later angers early adopters unless communicated up front. Mitigation: an explicit early-access price lock.
9. **Stripe price drift.** The 4.1% stack is based on Secondary figures. Re-verify (gate P6).

---

## 9. Recommendation: GO WITH CHANGES

**Why GO.** Unit economics are strong. Contribution margin is **62–83% in year 1 and 87–91% in steady state** per company. Haiku 5.5 receipt extraction costs **under $0.25/month even at 200 receipts**. Storage and audit logging are pennies. Break-even is **about 18 paying companies**. The price undercuts every construction-specific competitor and roughly doubles Built2Bid's ARPU for a Standard customer ($19.99 to $44.98).

**Changes required before launch:**

1. **Launch as "Financial Command Center, Early Access" at $24.99/month including 3 financial users, and $4.99/month per extra user, with a 12-month price lock** for early adopters. This is the Phase 1 scope: invoices, manual payments, job costing, vendor bills, documents and AI receipts.
2. **Plan a list price step-up to $34.99–$39.99 base (and $5.99–$7.99 per extra user)** when bank import with reconciliation and the double-entry GL ship and pass CPA review. Grandfather early adopters for 12 months, then give 60 days' notice.
3. **Add an annual option on day one:** **$249/year base (about 17% off) and $49.99/year per extra user.** This is required for Standard annual subscribers and matches the PM add-on's annual ratio.
4. **Define the seat:** "financial user" = anyone with the Financial role. On Standard they need not be Unlimited licensees. On Enterprise they must be licensed members. **Add 1 free read-only Accountant seat.**
5. **Include fair use:** up to 1,000 AI receipt extractions per company per month, then manual entry. Document storage is included (fair use 25 GB per company).
6. **Exclude and price separately later:** bank feeds (pass-through) and online payments (Stripe's standard rates, paid by the contractor; no Built2Bid markup at launch).
7. **Wording guardrails:** no "accounting software", "GL", "tax-ready" or "reconciled books" claims until the GL ships and passes CPA review.

**Suggested pricing copy (predictable pricing):**
> **Financial Command Center: $24.99/month.** Includes 3 financial users. Add more for $4.99/user/month. Or $249/year.
> Invoices, payment tracking, job costing, vendor bills and receipt scanning, all in one place. No setup fees. No per-invoice fees. Your accountant gets free read-only access.
> Cancel anytime. Your records stay available read-only, and you can export everything.
> *Early-access price locked for 12 months.*

---

## 10. Approval gates (pricing and billing)

- **P1** Owner approves the final price points (monthly and annual), the seat definition and the free Accountant seat.
- **P2** Owner creates the 4 Stripe Prices in **test mode** first. The implementing agent verifies them with a `pmPriceMismatch`-style check. Live prices only after test sign-off.
- **P3** Confirm the product tax code for the new Product (same as Unlimited) in Stripe Tax settings.
- **P4** Approve the cancellation, read-only and retention policy (section 1.1) and publish it in Terms.
- **P5** CPA review (Phase 1 scope) is completed before marketing uses financial terminology. Budget $3k–$8k.
- **P6** Re-verify all Secondary prices (Stripe fees, QBO, competitors, bank-feed vendors) on official pages before publishing comparison copy.
- **P7** Decide whether to enable Supabase PITR (about $100/month) before storing customer financial records. Recommended: yes.

---

## Sources

Verified this session:
- Claude pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Claude vision token cost: https://platform.claude.com/docs/en/build-with-claude/vision
- Supabase compute: https://supabase.com/docs/guides/platform/manage-your-usage/compute
- Supabase storage: https://supabase.com/docs/guides/platform/manage-your-usage/storage-size
- Supabase egress: https://supabase.com/docs/guides/platform/manage-your-usage/egress
- Supabase backups and PITR: https://supabase.com/docs/guides/platform/backups
- IRS record keeping: https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records
- Repository: `src/lib/billing/*`, `src/lib/enterprise/pricing.ts`, `src/lib/pm/*`, `src/app/api/stripe/*`, `src/app/api/billing/pm-addon/route.ts`, `supabase/migrations/20261114006000_enterprise_billing.sql`, `supabase/migrations/20261116003000_pm_entitlements.sql`, `src/lib/ai/provider.ts`

Secondary (official pages not reachable from this session; confirm):
- Stripe pricing: https://stripe.com/pricing (cards, ACH, Billing 0.7%, Tax 0.5%, Financial Connections)
- Stripe Connect pricing: https://stripe.com/connect/pricing
- QuickBooks Online: https://quickbooks.intuit.com/pricing/ (figures via nerdwallet.com, auditfriendly.co, dancingnumbers.com)
- JobTread: https://www.jobtread.com/pricing (via projul.com, capterra)
- Buildertrend: https://buildertrend.com/pricing (via projul.com, costbench.com)
- Contractor Foreman: https://contractorforeman.com/pricing (via pricingsaas.com, costbench.com)
- Knowify: https://knowify.com/pricing (via costbench.com, softwares.com)
- Plaid: https://plaid.com/pricing/ (via activepieces.com)
- Supabase database overage: third-party summaries (schematichq.com, saaspricepulse.com)
