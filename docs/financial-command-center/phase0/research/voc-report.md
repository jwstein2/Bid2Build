# QuickBooks Voice of Customer Report — Built2Bid Financial Command Center (Phase 0)

Prepared: 2026-11-17 · Agent 1 (Market Intelligence & Product Design) · Research only, no code
Companion files: `evidence.csv` (row-level evidence, IDs E001–E144), `qbo-feature-benchmark.md`, `competitor-matrix.md`

---

## 1. Methodology, sample size and access limits (read this first)

**How evidence was gathered.** I used web search only, through a search tool that returns result titles, URLs and short summaries of the pages. **Direct page fetching was blocked in this session.** `quickbooks.intuit.com` and `nerdwallet.com` both failed DNS resolution under the session's network allowlist, so I stopped trying to fetch pages. **Reddit is blocked for the search tool's user agent** (HTTP 400, "domains not accessible"). In practice:

- Every observation comes from a search-result summary of a public page: a title, the URL, and a sentence or two. I did not read full threads. Where a summary drew on several pages and I could not tell which URL a given sentence came from, the CSV says "attribution approximate" and gives a lower confidence.
- I did not access any G2, Capterra, TrustRadius, Trustpilot or ConsumerAffairs page directly. Figures from those sites (for example "55% negative of 846 Capterra reviews" or "Trustpilot ~1.1/5") are what the search engine reported about their public summary pages. Treat them as indicative, not audited.
- Capterra, GetApp and Software Advice are one Gartner review network. I counted their summary-level findings once per theme and did not count them again as separate sources.
- I did not use any private communities, logged-in content or restricted review databases.
- **The Intuit plan-page facts are not first-hand.** I could not open intuit.com, so plan facts and prices come from search summaries of Intuit's own pages (release notes, help articles, product pages) and from third-party pricing explainers. See the benchmark file for confidence on each fact.

**Sample size achieved (honest count).**

| Bucket | Rows in `evidence.csv` |
|---|---|
| Total distinct observations | **144** (138 distinct URLs) |
| User / reviewer voice (individual posts and aggregated review summaries) | ~99 |
| Vendor-official, analyst, competitor or consultant facts | ~45 |
| Complaint / neutral / praise | 98 / 36 / 10 |
| Construction relevance high / med / low | 64 / 47 / 33 |

The ~150 target was nearly met in row count. The **user-voice share is about 100**, and most of those are thread titles plus summary sentences, not full reads. The praise count (10) is low because I aimed the searches at problems. That is a sampling bias: QBO has broad satisfied usage, with G2 at about 4.0/5 on ~3,863 reviews and Software Advice at about 4.3/5 on ~1,487, per [aggregated snippets](https://g2.com/products/quickbooks-online/reviews?page=2).

**Recency.** I prioritized 2025–2026 material. Many Intuit Community threads show only relative ages, so their dates are approximate. Older threads (for example ContractorTalk from about 2015–16, and progress-invoicing threads from 2023–24) are marked as dated. Several of them describe gaps that **QBO Advanced partly closed in August 2026** (see §5).

**Evidence labels used below:**
- **[ANEC]** individual anecdote
- **[COMM]** repeated community theme (3 or more independent threads)
- **[AGG]** aggregated review finding (platform summary)
- **[OFF]** official product limitation or status (Intuit's own pages)
- **[INF]** researcher inference

---

## 2. Major positive themes (what QuickBooks does well, which we must match)

| # | Theme | Label | Evidence |
|---|---|---|---|
| P1 | Bank feeds, rules and recurring transactions remove a lot of manual work | [AGG] | E031–E033 ([softwarefinder](https://softwarefinder.com/accounting-software/quickbooks-online/reviews?page=16), [GetApp](https://www.getapp.com/finance-accounting-software/a/quickbooks-online-edition/reviews/74c313dfde/)) |
| P2 | Accountant collaboration: a free accountant seat, and nearly every accountant knows it | [AGG]+[ANEC] | E134, E136 ([G2](https://g2.com/products/quickbooks-online/reviews?page=2), [HN ProAdvisor](https://news.ycombinator.com/item?id=36022104)) |
| P3 | Ease of use and access from anywhere (cloud) | [AGG] | E048 ([G2 summary](https://www.g2.com/products/quickbooks-online/reviews?qs=pros-and-cons)) |
| P4 | An integration ecosystem: "most other tools make sure to integrate" | [ANEC] | E136 |
| P5 | Receipt capture and expense categorization work for many users | [AGG] | E112 ([Capterra](https://www.capterra.com/p/190778/QuickBooks-Online/)) |
| P6 | Guided onboarding and support praised on the UK Trustpilot page (~3.7/5, ~17k reviews) | [AGG] | E013 |
| P7 | Help for Desktop migrators, such as a 60-day implementation consultant on Advanced | [OFF] | E104 |

**Implication [INF]:** Built2Bid's ledger cannot be a downgrade on bank-feed automation, reconciliation or accountant access. These are expected as standard. The opportunity is not "better generic bookkeeping". It is financials that already know the contract.

---

## 3. Major negative themes

### 3.1 Pricing, price hikes, forced upgrades and add-ons — **[OFF]+[AGG]+[COMM]**
- Intuit raised Essentials, Plus and Advanced for renewals on or after **2026-08-01**. Simple Start, Free, Lite and Ledger were unchanged ([Intuit](https://quickbooks.intuit.com/r/product-update/quickbooks-price-changes/), E001). Third parties report **$38 / $85 / $140 / $340** list prices, up from $38/$75/$115/$275 ([auditfriendly](https://auditfriendly.co/answers/quickbooks-online-price-increase-2026), E002). This is not verified on intuit.com. The figures conflict elsewhere: one blog cites a "May 2026" price list of $35/$70/$110/$250, and one competitor blog claims an Advanced rise of up to 70%.
- G2 calls "aggressive and frequent price increases" the most consistent complaint (E007). A Capterra summary reportedly has 55% of 846 reviews negative, citing increases and add-ons (E008). NerdWallet notes complaints about upselling and yearly summer increases (E009).
- **Forced add-ons:**
  - Payroll cost allocation to projects needs Workforce Premium or Elite on top of Plus (E091).
  - 1099 e-file needs a payroll or Contractor Payments subscription (E123).
  - Custom roles need Advanced (E106).
  - Estimate-vs-actual project cost tracking was Advanced-only as of Feb 2026 (E090).
  - Classes and locations are capped at 40 on Plus, cut from unlimited in 2022 (E108).
- Billing friction: charges continuing after cancellation and a hard cancellation flow (E130–E131) **[COMM]**.

### 3.2 Support — **[AGG]+[COMM]**
Multi-hour holds, transfers and conflicting answers come up across BBB (with a caveat: the profile may not be Intuit's official one), ConsumerAffairs, Trustpilot's US page (~1.1/5, ~94% one-star) and G2 summaries (E010–E017).

### 3.3 Bank feeds, duplicates and reconciliation — **[OFF]+[COMM]**
- **Duplicate transactions** have documented root causes:
  - an account connected twice;
  - reconnecting, which re-downloads history;
  - deleting a transaction instead of excluding it, which brings it back;
  - pending authorizations;
  - post-migration overlap (E018–E022).
- **Feeds dropping:** error 103 even with correct credentials, and "not working again" (E027–E029).
- **Reconciliation drift:** reconciled items edited later break beginning balances. One reported case had a ~$48K difference after a bookkeeper handover (E023–E025). Undoing a whole reconciliation needs the accountant-only tool (E026).
- **Silent misclassification:** accountants charge more for feed cleanup (E030).

### 3.4 AI categorization imposed on users — **[COMM]+[OFF]**
Users say AI categorization "gets most wrong" and adds work, and they cannot fully turn AI or the Business Feed off. Per Intuit answers, only bank-categorization AI and the Payroll Agent can be disabled (E034–E037). Intuit Intelligence is **beta**, chat is admin-only, and usage is capped by plan (E038). Bank-feed lag is attributed to recalculating suggestions (E039).

### 3.5 Speed and forced UI changes — **[COMM]**
Users report 2–20 second waits, invoice clicks taking 4–5 seconds, and a forced dashboard and invoice redesign with the classic opt-out removed (E039–E047).

### 3.6 Job costing and projects — **[COMM]+[AGG]+[OFF]**
- Labor shows on projects only after billable time is invoiced (E070).
- A global labor-costing toggle changes every project at once (E071).
- Costs posted to the wrong account types never reach the project (E072).
- PTO and employer taxes are stuck in "Not Specified" (E074), and labor gets double-counted (E075).
- Reports have moved or disappeared (E076).
- Users write "Project costing does not work period" (E073).
- **POs are non-posting**, so committed costs are invisible in standard job cost. A subcontract balance shows only once the full commitment has been billed (E079–E080). Committed-cost and cost-group reports were limited to Advanced with the Construction add-on or IES (E081).
- Construction reviewers report friction from bloated charts of accounts, WIP accuracy problems and phase/trade breakdowns (E083–E084).

### 3.7 Progress billing, retainage and change orders — **[OFF]+[COMM]**
- Official progress invoicing:
  - edits are allowed only on the original estimate, and only until it is fully invoiced;
  - billing can never exceed 100% of the estimate (E049);
  - quantity locks (E050).
- Community advice is to **avoid changing the estimate once billing starts and open a new job for change orders** (E051, mostly Desktop-era). The progress-invoicing toggle turns itself off (E052). The new invoice experience didn't support progress invoicing in 2023–24 (E053–E056) and still lists missing features (E057).
- **Retainage:**
  - it is entered by hand as a negative line, with the percentage calculated manually (E060);
  - on a cash basis, the full invoice counts as income (E059);
  - account-type confusion (E062);
  - retainer and retainage get conflated (E061).
- Intuit's own subcontractor page sends buyers who need **retainage, SOV or AIA-compliant billing beyond standard progress invoicing to Intuit Enterprise Suite**. There, SOV, G702/G703 pay apps and Retainage AR/AP are **beta / coming soon** (E064, E098).

### 3.8 WIP — **[COMM]** (now partly outdated)
Before August 2026, accountants built WIP and over/under-billing in Excel and posted adjusting entries back (E092–E093). **Advanced now advertises WIP, cost-to-complete and eight new project reports** (E094–E096). Whether they are accurate in practice is unverified, since I found no user feedback yet.

### 3.9 Permissions — **[OFF]+[ANEC]**
Custom roles exist only on Advanced and IES (E106). One unverified claim says Plus limited roles began exposing financial reports without notice (E107). Field staff seeing company financials is a recurring contractor concern [INF].

### 3.10 Mobile — **[COMM]**
Receipt-scan edge detection is poor, the feature sometimes disappears after updates, and the app is described as a thin version of the web product (E109–E111).

### 3.11 Migration from Desktop to Online, and Desktop status — **[OFF]+[COMM]**
- Duplicates after migration (E019).
- Memorized reports, audit trail and reconciliation reports don't carry over (E102).
- Job-cost reports become one report per job (E089).
- Inventory valuation and class tracking change (E103).
- **Desktop status:**
  - New sales of Pro Plus, Premier Plus and Mac Plus stopped on 2024-09-30. Enterprise is still sold (E099).
  - Desktop 2023 services ended on 2026-05-31 (E101).
  - Intuit now says Desktop 2024 **will not be discontinued in May 2027** (E100).
- **Inference [INF]:** the forced-migration wave is weaker than expected, so Built2Bid must win on value, not on a deadline.

### 3.12 Payments holds — **[COMM]**
Users report deposits held for compliance review, conflicting answers on limits, and a 2026 account closure described as "final" (E113–E115). Fees are about 2.99% on invoiced cards and 1% on ACH, and whether ACH is capped is disputed (E116).

### 3.13 Sales tax and 1099 — **[COMM]**
Users report wrong location rates, labor taxed when only parts should be, markup taxation, and 1099 e-file stalls (E117–E124).

### 3.14 Time & materials and markup — **[COMM]**
Billable expenses carry cost instead of the sale price. Markup gets applied on top of tax. Bundles can't carry a markup. The new template doubles quantities. Bills from Bill.com lose their billable flags (E125–E129).

---

## 4. Contractor-specific issues (synthesis)

1. **No contract object.** QBO models an *estimate*. Contractors work on a *signed contract plus approved change orders*. Every workaround (a new job per change order, manual retainage lines, the 100% billing cap) comes from this mismatch [INF, backed by E049–E052, E059–E063].
2. **Labor cost is the hardest part.** It depends on payroll vendor settings, invoicing state and toggles (E070–E078).
3. **Committed costs and subcontracts are invisible** without the construction edition (E079–E082).
4. **Retainage needs to be an AR and AP sub-ledger**, not a negative invoice line (E059–E067).
5. **WIP and over/under billing** has historically lived in Excel at the CPA (E092–E093).
6. **Field capture:** receipts and time have to land on the job and cost code from a phone (E109–E110).
7. **Construction features are gated** to QBO Advanced at $340/mo (reported), US-only, with job hierarchies still "coming soon" (E094–E095).

---

## 5. What QuickBooks shipped in 2026 for construction (verified from Intuit-owned pages via search summaries)

- **August 2026:** Construction (and professional services) solutions are **included in QBO Advanced at no extra cost**. Before that they were a paid add-on. They cover job costing, budget-vs-actuals, **AIA-style progress billing tied to phases and milestones**, **change order management** (approval updates the estimate, budget and invoice), **WIP reporting** and profitability. Bill Pay Elite moved into Advanced. ([Intuit Aug 2026](https://quickbooks.intuit.com/r/product-update/whats-new-quickbooks-advanced-august-2026/), [firmofthefuture](https://www.firmofthefuture.com/product-update/whats-new-quickbooks-online-advanced-fall-2026/))
- **September 2026:** Eight new project reports by dimension, including cost-to-complete and WIP ([firmofthefuture](https://www.firmofthefuture.com/product-update/september-2026-mpu/)).
- **Fall 2026:**
  - Field labor hours flow into job costs.
  - AIA-style progress invoice payments reconcile automatically.
  - Bill Pay handles subcontractor payments with 1099 tracking.
  - The Project Management agent can set up a project from documents.
  - **Coming soon:** labor costing by service item, and multi-level job hierarchies.
  - Construction features are **not available outside the US**.

  ([Intuit Fall 2026 Advanced](https://quickbooks.intuit.com/r/product-update/whats-new-quickbooks-advanced-fall-2026/))
- **Still limited:** "AIA-style" invoices are **not certified by or affiliated with the AIA**. Schedule of Values, G702/G703 payment applications and **Retainage AR & AP** are listed as **beta / coming soon in Intuit Enterprise Suite**, and Intuit's FAQ points retainage and SOV buyers to IES ([Intuit subcontractor page](https://quickbooks.intuit.com/online/advanced/industries/subcontractor/), [IES construction](https://erp.intuit.com/construction/)). Third-party reviewers disagree about IES's G702/G703 status: [ConstructionCoverage](https://constructioncoverage.com/software/accounting/quickbooks-for-contractors) says it is native, while [Knowify](https://knowify.com/resources/intuit-enterprise-suite-review/) (a competitor) and [RedHammer](https://www.redhammer.io/blog/intuit-enterprise-suite-spring-2026-release-full-feature-breakdown-for-construction-companies) say it is missing. **I found no independent user reviews of the Aug 2026 Advanced construction features.**

---

## 6. Accountant / bookkeeper requirements (what makes a CPA say yes)

| Requirement | Why | Evidence |
|---|---|---|
| Real double-entry GL, trial balance, journal entries with attachments | Non-negotiable for a tax return or review | [INF] |
| Free accountant seat and a multi-client view | QBOA is free and familiar. QBOA retires 2026-12-31 and moves to Intuit Accountant Suite (Accelerate is paid from 2027) | E134–E135 |
| **Hard period close** (role-gated reopen, with a reason) | The QBO closing date only warns or asks for a password, so it is a deterrent, not a lock | E132 |
| Immutable audit log that accountants can read | The QBO audit log needs admin access | E133 |
| Reconciliation snapshots that cannot silently drift, plus owner-safe "undo reconciliation" | E023–E026 | |
| Clean export (GL detail, TB, AR/AP aging, 1099 vendor totals) and a QBO sync during the transition | Accountants won't abandon their QBO-based workflows overnight | E136 |
| WIP schedule with over/under-billing and a suggested adjusting JE | Today it is rebuilt in Excel every month | E092–E093 |
| Cash and accrual reports that handle retainage correctly | E059 | |

---

## 7. Switching barriers

1. **Accountant lock-in and familiarity** (E136): the free QBOA/ProAdvisor channel. Inference: the QBOA→Accountant Suite transition and paid tiers create a short window of accountant churn.
2. **Historical data and reports:** memorized reports, the audit trail and reconciliation history don't migrate cleanly even within Intuit's own products (E102).
3. **Payroll, sales tax and 1099 compliance** live inside QBO's add-ons. Replacing them is a regulatory product, not a feature (see §11).
4. **Integration ecosystem** (E136).
5. **Bank-feed re-authorization effort** and the risk of duplicates when overlapping systems (E018–E019).
6. **Desktop is not actually dying soon** (E100), which reduces urgency.
7. **Trust in a newer vendor holding the books** [INF].

**Design response [INF]:** start as the **operational system of record that syncs to QBO**, so the accountant keeps QBO. Become the GL later, once the contractor's financial truth already lives in Built2Bid.

---

## 8. UX anti-patterns to avoid (taken from the complaints)

1. Forced UI redesigns with no opt-out or feature parity (E041–E045, E057).
2. AI that auto-applies changes, can't be turned off, and doesn't explain itself (E034–E037).
3. Global toggles that silently change historical reports, like the labor-costing switch or progress invoicing turning itself off (E052, E071).
4. "Soft" locks on closed periods and reconciliations (E023–E026, E132).
5. Upsell walls in the middle of a workflow, where features sit one tier up (E090–E091, E106).
6. Report locations that move with each release (E076).
7. Interactions slower than 1 second on high-volume screens like the bank feed and invoices (E039–E041).
8. Tax and compliance logic that users can't inspect (E117–E121).
9. Deleting a record that then comes back from the bank feed (E018).
10. Hiding a "cancel subscription" path (E130–E131).

---

## 9. Ranked customer problems with the Built2Bid product response

Ranking = frequency of evidence × severity × construction relevance × Built2Bid's structural advantage. This is my judgment.

| Rank | Problem | Labels | Built2Bid response |
|---|---|---|---|
| 1 | **Billing against a changing contract**: progress billing capped at the original estimate, change orders forcing workarounds | OFF + COMM | The signed proposal becomes the **contract and Schedule of Values automatically**. Approved change orders add SOV lines. Pay applications (G702/G703-*style*) bill % complete per line with billed-to-date history. No re-entry. |
| 2 | **Retainage handled as a manual negative line**, wrong on a cash basis | OFF + COMM | Retainage % per contract or line. A retainage receivable and payable sub-ledger. Release invoices. Correct cash and accrual treatment. |
| 3 | **Job cost (actual vs estimate) unreliable**, especially labor | COMM + AGG | Budget = estimate lines by cost code at signature. Costs (bills, receipts, time × burdened rate) post to the job and cost code at entry, independent of invoicing. Job cost always ties out to the ledger. |
| 4 | **Committed costs and subcontract balances invisible** | OFF + COMM | Sub contracts and POs issued from the estimate and sent to the existing subcontractor directory. Committed = contract + COs − billed. Sub bills checked against the commitment. Sub retainage held. |
| 5 | **WIP and over/under billing done in Excel** | COMM (partly fixed in QBO Advanced) | Built-in WIP schedule (cost-to-cost % complete with PM override), over/under-billing and a one-click suggested JE or export for the CPA. |
| 6 | **Price hikes and features gated to a $340 tier** | OFF + AGG | Construction financials included in the Built2Bid plan. Published price-lock. No per-feature upsell walls. |
| 7 | **Bank-feed duplicates and drift, plus reconciliation fragility** | OFF + COMM | (GL phase) Idempotent imports, pending items never posted, hard-locked reconciliations, a reconciliation diff view. |
| 8 | **Getting paid on large invoices**: payment holds, card fees on big draws | COMM | ACH-first payments on pay apps, with funding status visible. Card surcharging only where legal. Payment links tied to signed contracts reduce risk flags [INF]. |
| 9 | **Permissions**: field staff vs financials | OFF + ANEC | Role templates (owner, PM, foreman, office, bookkeeper, accountant) on every tier, with job-level scoping. |
| 10 | **Support and UX churn** | AGG + COMM | Stable UI contracts, in-app human support, and fast screens (performance budget). |
| 11 | T&M and cost-plus markup mistakes | COMM | Contract types (lump sum, T&M, cost-plus, unit price), with markups per cost type taken from the proposal. |
| 12 | Mobile receipt and time capture to the job | COMM | Mobile capture straight to job and cost code, with approvals. |
| 13 | AI imposed and wrong | COMM | Deterministic flows first. AI is optional, explains its suggestions, and never auto-posts. |
| 14 | Sales tax and 1099 errors | COMM | Defer sales tax (integrate a tax engine). 1099 via W-9 collection plus vendor totals and partner e-file. |

---

## 10. Recommended MVP ("Financial Command Center v1": contract-to-cash, synced to QBO)

**Principle:** don't try to beat QBO at the general ledger in v1. Beat it at the **contract-to-cash and job-cost** workflow that Built2Bid already owns upstream, and **sync** the results to QBO or Xero so the accountant's GL stays put.

**In scope (Build):**
1. **Contract from the signed proposal:** SOV, contract value, retainage terms, billing method (progress %, milestone, T&M, cost-plus).
2. **Change orders tied to contract value:** approved CO → SOV line plus a budget update. CO log and contract summary (original + approved + pending).
3. **Invoices and pay applications:** progress invoices by line % or amount, G702/G703-style summary and continuation sheet, retainage withheld and released, billed-to-date, stored materials (optional). Deposits handled separately from retainage.
4. **Payments:** ACH and card payment links on invoices, partial payments, reminders, and a payment log feeding AR.
5. **AR aging and customer statements**, with retainage receivable shown separately.
6. **Job budget = estimate at signature, by cost code**, with budget revisions through COs.
7. **Costs:** vendor and sub bills (manual entry plus email/upload with OCR to suggest values only), receipts from mobile, time entries × burdened labor rate. All coded to job and cost code.
8. **Subcontracts / POs from estimate lines**, with committed-cost tracking and sub retainage payable.
9. **Job cost report:** estimate vs committed vs actual vs billed, cost-to-complete, projected margin. Portfolio view across jobs.
10. **WIP schedule** with over/under billing and a CSV/accountant export.
11. **QBO (and later Xero) sync:** customers, vendors, invoices, payments, bills, with job → QBO project or customer and cost code → item/class mapping. One-way push first, with conflict reporting.
12. **Roles and permissions** for financial objects, plus an audit log of financial edits and approvals for bills and COs.

**Explicitly out of v1:** bank feeds and reconciliation, GL, payroll, sales-tax calculation engine, 1099 e-file, inventory, multi-entity, AI agents. (Optional AI: drafting CO descriptions or invoice notes. Low priority.)

**v1 acceptance north-star:** a contractor signs a proposal, approves two COs, issues three pay apps with 10% retainage, records sub bills against a subcontract, and sees WIP. QBO receives every invoice, payment and bill with no double entry, and the AR, retainage and job-cost totals tie out between the two systems to the cent.

**v2 (GL foundation):** double-entry ledger built on the existing objects, chart of accounts template for construction, bank feeds through an aggregator, reconciliation, AP payments, P&L, BS and TB, hard period close, accountant workspace.
**v3 (replacement-grade):** 1099 e-file partner, sales tax engine integration, payroll integration (not built in-house), multi-entity, budgeting and forecasting, AI anomaly checks.

---

## 11. Full-replacement gap assessment (what it would take to replace QBO for a small contractor)

| Capability | QBO today | Built2Bid after v1 | Gap to replace | Recommendation |
|---|---|---|---|---|
| Double-entry GL, journal entries, TB, P&L, BS, cash and accrual | Yes, all tiers | No (synced to QBO) | Large: ledger engine, period close, CPA-grade reports | Build in v2 |
| Bank feeds (aggregator) and categorization rules | Yes (with duplicate and drift issues) | No | Large: aggregator contract (Plaid/MX/Finicity class), ops cost per connection, support load | Build in v2 via aggregator |
| Reconciliation | Yes | No | Medium–large | Build in v2 with hard locks |
| AP bill pay (ACH, check) | Yes (Bill Pay; Elite in Advanced) | Partial (bills only) | Medium: money movement partner, KYC | v2 via partner |
| AR, invoicing, payments | Yes | **Yes, construction-grade** | — | v1 |
| Payroll (tax filing, garnishments, certified/union) | Add-on ($50–$134/mo + $7–$17/employee reported, Oct 2026 sources) | No | Very large: regulatory, multi-state, liability | **Exclude**. Integrate (Gusto/ADP/construction payroll) and import labor cost |
| Sales tax calculation and filing | Automated sales tax (with complaints) | No | Large: rates, nexus, labor-vs-materials rules by state | Defer. Integrate tax engine (Avalara/TaxJar-class) |
| 1099 tracking and e-file | Needs payroll or Contractor Payments add-on for e-file | Vendor flag + W-9 collection (v1.5) | Medium: IRS IRIS/FIRE via partner | Build tracking. Partner for e-file |
| Inventory | Plus+ (FIFO) | No | Medium–large | Exclude (low contractor need) |
| Multi-entity / consolidation | IES | No | Large | Defer |
| Budgeting / forecasting | Plus/Advanced; AI forecasts (beta) | Job budgets only | Medium | Defer company budgets to v3 |
| Accountant access and tools | QBOA → Intuit Accountant Suite | Accountant role + exports | Medium | v2 accountant workspace |
| Integrations ecosystem | Very large | QBO/Xero sync | Large, structural | Partner/API strategy |
| Data migration from QBO/QBD | — | — | Medium: history import, opening balances | Build import in v2 |

**Bottom line [INF]:** Full replacement is a multi-year effort, and payroll plus sales tax are the hardest parts. A credible path: **v1 owns contract-to-cash and job cost (synced)** → **v2 owns the GL and bank feeds** → **v3 integrates the compliance products**, never building payroll.
