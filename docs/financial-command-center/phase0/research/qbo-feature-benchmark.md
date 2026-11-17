# QuickBooks Online Feature Benchmark (US) for Built2Bid's Financial Command Center

Prepared: 2026-11-17 · Agent 1 · Phase 0 research

## Source access caveat (important)
- **I could not open Intuit's official plan pages.** `quickbooks.intuit.com` was blocked by this session's network allowlist (DNS failure on fetch). Every Intuit fact below comes from **search-engine summaries of Intuit-owned pages**: release notes, help articles, product pages and firmofthefuture.com, which is Intuit's accountant blog. Each row carries a confidence level:
  - **H**: an Intuit-owned page confirmed it via its search summary.
  - **M**: an Intuit page partly confirms it, or several third parties agree.
  - **L**: third-party only, or sources conflict.
- **Before quoting any price externally, check the pricing page** (https://quickbooks.intuit.com/pricing/) **by hand.**
- Plan feature membership for Simple Start, Essentials and Plus partly reflects Intuit's long-standing tiering. Where a 2026 source contradicts it, I say so.
- **Update:** the owner supplied a screenshot of Intuit's current plan feature list (`../sources/quickbooks-plan-screenshot.png`). I viewed it directly. §0 below is the **authoritative benchmark inventory**, taken exactly from that screenshot with its NEW/BETA labels kept. Where it conflicts with the third-party plan gating in §3B, **§0 wins**.

---

## 0. Benchmark inventory: Intuit plan feature list (owner screenshot, verbatim labels)

**What the screenshot does and doesn't show:**
- It shows five columns but **no plan names or prices**.
- The column order is mapped as Free/lowest → Simple Start → Essentials → Plus → Advanced, as the coordinator instructed. The feature progression is consistent with that mapping. I could not verify it independently.
- Each column lists only what it adds. I assume higher tiers include the features of lower tiers, which is Intuit's usual "everything in X, plus" pattern. That is an assumption, not something the screenshot shows.
- "Intuit Intelligence" rows are AI features. Plain checkmarked rows are core features.
- Status labels are the screenshot's own **NEW** and **BETA**. Rows with no label are presumed GA.

**Column guide**
- **Rec** = Built2Bid recommendation.
- **Cost** = implementation cost, then ongoing cost.
- **Contractor need:** H, M or L.

| # | Feature (verbatim) | Tier first shown | Label | Type | Contractor need | Rec | Cost | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| 1 | Send 2 invoices per month | Free/lowest | — | Core | L | n/a | — | — |
| 2 | Run profit & loss report | Free/lowest | — | Core | H | Defer (v2 GL); sync to QBO in v1 | L / low | P&L ties to GL detail |
| 3 | Connect 1 bank | Free/lowest | — | Core | H | Defer (v2, aggregator) | L / high | No duplicates on reconnect |
| 4 | Chat support | Free/lowest | — | Support | H | Build (in-app human support) | S / staff | Ticket SLA visible |
| 5 | Intelligent onboarding with expert-guided setup | Simple Start | NEW | AI | M | **Redesign**: trade presets (V3 addendum), no AI needed | S / low | Choosing a trade seeds cost codes, cards and reports |
| 6 | AI Chat for instant insights (Limited capacity) | Simple Start | BETA | AI | M | Defer | M / LLM tokens | Answers cite source records |
| 7 | Categorizes expenses | Simple Start | — | AI | H | **Redesign**: suggest only, goes to Needs Review | M / ML cost | Nothing posts without confirmation |
| 8 | Maximizes tax deductions | Simple Start | NEW | AI | L | Exclude | — | — |
| 9 | Handles the busywork (Learns & performs tasks) | Simple Start | BETA | AI | L | Exclude | — | — |
| 10 | Run general business reports | Simple Start | — | Core | H | Build (job-centric core reports) | M / low | Every total drills down |
| 11 | Automated bookkeeping | Simple Start | — | Core/AI | M | Defer (v2) | — | — |
| 12 | Invoice and get paid | Simple Start | — | Core | H | **Build (contract-native)** | M / processor | Invoice from signed proposal reconciles to AR |
| 13 | Automate bill pay with free ACH | Simple Start | — | Core | H | Defer (needs money-movement partner); v1 = bills only | L / partner fees | — |
| 14 | Annual books check-in with action plan | Essentials | NEW | AI | L | Exclude | — | — |
| 15 | Cleans up your books, fast (with Accounting AI) | Essentials | — | AI | M | Defer | — | — |
| 16 | Creates invoices in bulk, automatically | Essentials | BETA | AI | M | **Build deterministically**: pay apps drafted from SOV for all active jobs | S / none | Draft all due pay apps in one action |
| 17 | Gets you paid faster (with Payments AI) | Essentials | — | AI | H | Build rule-based reminders | S / messaging | Reminders stop on payment |
| 18 | Estimates quarterly payments (with Business Tax AI) | Essentials | — | AI | L | Exclude | — | — |
| 19 | Run enhanced reports | Essentials | — | Core | H | Build (AR aging, job cost, WIP) | M / low | Totals reconcile |
| 20 | Add employee time to invoices | Essentials | — | Core | H (T&M/SVC) | **Build** (time → job/cost code → T&M invoice) | M / low | Approved hours bill at contract rates |
| 21 | Integrate third-party data into KPIs and dashboards | Essentials | NEW | Core | L | Defer | — | — |
| 22 | Collect leads from a custom form on your website | Essentials | — | Core | M | n/a (Built2Bid pipeline exists per brief; validate) | — | — |
| 23 | Reconciles your books | Plus | — | AI | H | Defer (v2), hard-locked reconciliations | M / low | Locked period can't change |
| 24 | Transactions auto-categorized and verified | Plus | NEW | AI | H | Redesign (suggest + review queue) | M / ML | Precision tracked |
| 25 | Surfaces profit & loss insights | Plus | — | AI | M | Defer | — | — |
| 26 | Chat to plan scenarios and save as budgets | Plus | BETA | AI | L | Exclude v1 | — | — |
| 27 | Finds and fixes anomalies | Plus | — | AI | M | Defer (deterministic checks first: duplicate bill, over-commitment, overbilling) | S / low | Over-commitment warning fires |
| 28 | Catch discrepancies pre-filing (with Sales Tax AI) | Plus | — | AI | M | Defer (tax engine) | — | — |
| 29 | Sources leads and follows up (with Customer AI) | Plus | — | AI | L | n/a (pipeline exists per brief) | — | — |
| 30 | Run comprehensive reports | Plus | — | Core | H | Build (job portfolio, committed, retainage) | M / low | — |
| 31 | Plan budgets | Plus | — | Core | M | Build job budgets (company budgets deferred) | M / low | Budget = signed estimate |
| 32 | Track project profitability | Plus | — | Core | H | **Build** (estimate vs committed vs actual vs billed) | M / low | Ties to cent |
| 33 | Track and manage inventory | Plus | — | Core | L | Exclude | — | — |
| 34 | Track classes and locations (40) | Plus | — | Core | H (as dimensions) | **Redesign**: uncapped project/phase/cost-code/trade dimensions | S / low | No caps |
| 35 | Auto-creates projects and allocates costs (with Project Management AI) | Advanced | — | AI | H | Build later: suggest job/cost code; human approves. Project creation from signed proposal is already deterministic. | M / LLM | Nothing auto-posts |
| 36 | Continuous books quality checks, with quarterly insights | Advanced | NEW | AI | M | Defer | — | — |
| 37 | Gives financial insights tailored to your business (with Finance AI) | Advanced | — | AI | M | Defer | — | — |
| 38 | Customize dashboards with personalized KPIs and metrics to measure what matters most | Advanced | — | AI/Core | H | **Build** (trade-preset cards, admin-customizable, essential alerts unhideable) | M / low | Reorder/hide cards; alerts persist |
| 39 | Track performance with unlimited classes, locations, and custom KPIs | Advanced | — | Core | H | Build (see #34) | — | — |
| 40 | Free 1099 e-filing and approval workflows with Bill Pay Elite** | Advanced | NEW | Core | H | Build 1099 tracking + approvals; partner for e-file. **Note:** Intuit help says 1099 e-file otherwise needs Payroll or Contractor Payments (E123), so Advanced includes it through Bill Pay Elite. | M / per-form fee | Year-end totals = payments to 1099 vendors |
| 41 | Construction financials solution | Advanced | NEW | Core | H | **Build (core differentiator, in base FCC price)** | L / low | Proposal → contract → CO → pay app → job cost → WIP, no re-entry |
| 42 | Advanced project financials | Advanced | NEW | Core | H | **Build** (committed costs, cost-to-complete, WIP) | M / low | WIP math fixture passes |
| 43 | Customize user permissions and access | Advanced | — | Core | H | **Build in every tier** (role templates, job-scoped) | M / low | Foreman can't see AR or P&L |
| 44 | Automate workflows | Advanced | — | Core | M | Build approvals (bills, COs, POs) and reminders | M / low | Bill > $X needs PM approval |
| 45 | Sync data with Excel | Advanced | — | Core | M | Build export (all reports); defer two-way sync | S / low | Export totals match |
| 46 | Batch invoices and expenses | Advanced | — | Core | M | Build grid entry later | S / low | Paste 100 lines validated |
| 47 | Get priority support and training | Advanced | — | Support | H | Build (human support for all FCC tiers) | — / staff | — |

**Takeaway from the screenshot [INF]:** Intuit labels **"Construction financials solution" and "Advanced project financials" as NEW and Advanced-only**, which confirms the Aug 2026 release notes. **Custom permissions, approval workflows and unlimited dimensions are also Advanced-only**, at $340/mo reported. Built2Bid can include all of these in a $24.99 FCC plan; per the addendum, presets never gate entitlements. Many headline AI items are BETA or NEW. Most aren't core contractor pain points and are better replaced with deterministic construction automation.

---

## 1. Plans, US list prices and user limits

| Plan | Reported list price (USD/mo, after 2026-08-01 change) | Prior list | Users | Confidence | Notes |
|---|---|---|---|---|---|
| QuickBooks Free / Lite | not verified | — | — | L | Intuit says Free and Lite prices were unchanged in Aug 2026 ([Intuit price-change notice](https://quickbooks.intuit.com/r/product-update/quickbooks-price-changes/)). Details not verified. |
| QuickBooks Ledger | ~$10 per company file (accountant-managed, no invoicing or bill pay) | — | — | L | [FitSmallBusiness](https://fitsmallbusiness.com/quickbooks-ledger-review/) |
| **Simple Start** | **$38** | $38 (unchanged) | 1 | M | Intuit confirms it was unchanged. The price comes from third parties ([auditfriendly](https://auditfriendly.co/answers/quickbooks-online-price-increase-2026), [erpresearch](https://www.erpresearch.com/pricing/quickbooks-online)). |
| **Essentials** | **$85** | $75 | 3 | M | Intuit confirms an increase on renewals from 2026-08-01. The amount is third-party. |
| **Plus** | **$140** | $115 | 5 | M | Same as above |
| **Advanced** | **$340** | $275 | 25 | M | Same as above. **Construction and professional-services solutions and Bill Pay Elite are now included** ([Intuit Aug 2026](https://quickbooks.intuit.com/r/product-update/whats-new-quickbooks-advanced-august-2026/)). One source says Workforce Elite payroll is bundled into Advanced; **unverified, and it conflicts with other sources.** |
| Intuit Enterprise Suite (IES) | No public price. Third-party estimates run ~$650–$1,250+/mo, or Capterra's "from $7,800/yr" | — | — | L | [erpresearch](https://erpresearch.com/en-us/intuit-enterprise-suite-pricing), [Capterra](https://www.capterra.com/p/10030198/Intuit-Enterprise-Suite/) |

**Conflicting price data:** one blog reports a "May 2026" list of $35/$70/$110/$250, and one competitor blog claims an Advanced increase of up to 70%. Most 2026 sources agree on $38/$85/$140/$340. For existing customers, Intuit says new subscribers keep their price for 6 months and the new price applies from the 7th invoice.

**Add-on pricing (reported, Oct 2026, third-party):**
- Payroll (renamed "Workforce"): Payroll $50 + $7/employee; Premium $88 + $13; Elite $134 + $17 ([saascrmreview](https://saascrmreview.com/?p=17488)). Gusto cites lower per-employee rates. **M/L**
- Payments: invoice card ~2.99%, in-person 2.5%, keyed 3.5%, ACH 1%. Sources disagree on whether the ACH fee is capped ([weaudit](https://www.weaudit.com/ratings/quickbooks-payments/quickbooks-payments-fees/)). **M**

**Usage limits (Intuit help, H):**
- Simple Start, Essentials and Plus: 250 accounts in the chart of accounts.
- Plus: 40 combined classes and locations, cut from unlimited in 2022.
- Advanced: unlimited accounts, classes and locations.

Source: [Intuit usage limits](https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-subscriptions/learn-usage-limits-quickbooks-online/L6THMltE4_US_en_US).

**QuickBooks Desktop / Enterprise status (H/M):**
- New US subscriptions to Pro Plus, Premier Plus, Mac Plus and Enhanced Payroll stopped on 2024-09-30. **Desktop Enterprise is still sold** (Silver, Gold, Platinum, Diamond) ([Intuit stop-sell](https://quickbooks.intuit.com/r/whats-new/quickbooks-desktop-stop-sell/)).
- Desktop 2023 services ended on 2026-05-31 (third-party guides).
- Intuit's Desktop 2024 page now says **2024 (Pro Plus, Premier Plus, Enterprise) will not be discontinued in May 2027**, and that Intuit is moving away from the 3-year lifecycle ([Intuit](https://quickbooks.intuit.com/learn-support/en-us/help-article/inventory-management/whats-new-quickbooks-desktop-2024/L381Krc4A_US_en_US)). The date of that statement is unverified.
- QuickBooks Online Accountant will be **discontinued on 2026-12-31** and replaced by Intuit Accountant Suite ([Intuit](https://quickbooks.intuit.com/accountants/intuit-accountant-suite/)).

---

## 2. QuickBooks 2026 construction facts (verified via Intuit-owned pages)

| Fact | Status | Source |
|---|---|---|
| Construction financials are **included in QBO Advanced at no extra cost** as of Aug 2026. They were a paid "Construction add-on" before. | GA (US only) | [Intuit Aug 2026](https://quickbooks.intuit.com/r/product-update/whats-new-quickbooks-advanced-august-2026/), [firmofthefuture Fall 2026](https://www.firmofthefuture.com/product-update/whats-new-quickbooks-online-advanced-fall-2026/) |
| Job costing, budget-vs-actuals, **AIA-style progress invoicing tied to phases and milestones**, **change order management** (an approved CO updates the estimate, budget and invoice), **WIP reporting**, profitability | GA in Advanced | same |
| Phase-based invoicing by % complete | GA (Advanced construction, IES) | [Intuit help: project phases](https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-projects/learn-project-phases/L5RLlXSSc_US_en_US) |
| Cost groups plus Estimate-vs-Actuals and **Committed Costs** reports | Advanced construction, IES | [Intuit help: cost groups](https://quickbooks.intuit.com/learn-support/en-us/help-article/job-costing/track-project-costs-cost-group/L7x4JzdtB_US_en_US) |
| Eight new project reports by dimension, including **cost-to-complete and WIP** | Sept 2026 | [firmofthefuture Sept 2026](https://www.firmofthefuture.com/product-update/september-2026-mpu/) |
| Field labor hours flow to job costs. AIA-style invoice payments auto-reconcile. Bill Pay for subs with automatic 1099 tracking. | Fall 2026 | [Intuit Fall 2026 Advanced](https://quickbooks.intuit.com/r/product-update/whats-new-quickbooks-advanced-fall-2026/) |
| Labor costing by service item, and **multi-level job hierarchies** | **Coming soon** | same |
| Construction features unavailable outside the US | Limitation | same |
| "AIA-style" invoices are **not affiliated with or certified by the AIA**. Intuit sends buyers who need **retainage, Schedule of Values, or AIA-compliant billing beyond standard progress invoicing** to IES. | Limitation | [Intuit subcontractor page](https://quickbooks.intuit.com/online/advanced/industries/subcontractor/) |
| IES: Schedule of Values, Payment Applications (G702/G703), **Retainage AR & AP** | **Beta / "coming soon"** (open beta, no extra cost for IES customers) | [IES construction](https://erp.intuit.com/construction/), [IES Fall 2026 notes](https://erp.intuit.com/blog/product-update/fall-2026-intuit-enterprise-suite-release-notes/) |
| Third parties disagree on whether IES G702/G703 output is GA: ConstructionCoverage says native; Knowify (competitor) and RedHammer say not yet | Conflict | [constructioncoverage](https://constructioncoverage.com/software/accounting/quickbooks-for-contractors), [Knowify](https://knowify.com/resources/intuit-enterprise-suite-review/), [RedHammer](https://www.redhammer.io/blog/intuit-enterprise-suite-spring-2026-release-full-feature-breakdown-for-construction-companies) |

**Retainage in QBO Advanced:** I found no source confirming a native retainage field in QBO Advanced. Intuit's own FAQ points retainage buyers to IES. Treat "QBO Advanced has native retainage" as **unverified / likely no**.

---

## 3. Capability benchmark table

**Legend**
- **Plan:** SS = Simple Start, E = Essentials, P = Plus, A = Advanced, IES = Intuit Enterprise Suite. "E+" means Essentials and every tier above it.
- **Status:** GA, Beta, Limited, or CS (coming soon).
- **Rec:** Build, Redesign (build it differently from QBO), Defer, or Exclude.
- **Cost:** S, M or L for implementation, then ongoing operating cost.
- **Feedback:** E-IDs refer to `evidence.csv`.

### 3A. Core accounting

| Capability | QBO support / plan / status (conf.) | Positive feedback | Negative feedback | Contractors need it? | Core pain | Rec | Dependencies | Impl. / Ongoing cost | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|
| Invoicing & payments | SS+ GA (H) | Easy invoicing, payment links (E048) | New invoice layout regressions and slowness (E043, E057). Payment holds (E113–E115). | Yes, critical | Invoices disconnected from the contract | **Build** (contract-native) | Contract/SOV model, payments processor | M / payments ops, processor fees pass-through | An invoice created from a signed proposal shows contract, prior billed, this period and retainage, and reconciles to AR |
| Progress invoicing | E+ basic progress invoicing on estimates (M). AIA-style by phase in A (H). | — | Locked to original estimate, 100% cap, toggle turns itself off, missing from new layout (E049–E056) | Yes, critical | Change orders break billing | **Redesign** | Contract, CO, SOV | M / low | After 2 approved COs, pay app #3 bills against the revised contract and billed-to-date is correct per line |
| Retainage | No native field in SS–P. Not confirmed in A. IES beta (M). | — | Manual negative lines, cash-basis distortion (E059–E063) | Yes (commercial, subs) | Retainage receivable and payable invisible | **Build** | AR/AP sub-ledgers | M / low | 10% retainage held on 3 invoices, released on final; AR aging shows retainage separately; cash-basis P&L excludes unreleased retainage |
| P&L / Balance sheet | SS+ GA (H) | Widely trusted | — | Yes | — | **Defer to v2 (GL)**. Sync to QBO in v1. | GL | L / low | TB balances; P&L ties to GL detail |
| Bank connections (feeds) | SS+ GA (H) | Feeds plus rules save time (E031–E033) | Duplicates, drops, error 103 (E018–E029). Wave moved feeds to paid (E140). | Yes | Duplicates and drift | **Defer to v2** (aggregator) | Aggregator vendor, GL | L / **high** (per-connection fees, support) | Reconnecting an account imports zero duplicates; pending items never posted |
| Reconciliation | SS+ GA (H) | Useful (E032) | Beginning-balance drift; undo is accountant-only (E023–E026) | Yes (bookkeeper) | Fragility | **Redesign (v2)** | GL, feeds | M / low | A reconciled period is locked; editing a reconciled item requires a reversal with a reason |
| Bills / AP | E+ GA (H). Bill Pay Elite included in A (Aug 2026). | — | Billable/markup gaps (E125–E129) | Yes | Sub bills not checked against commitments | **Build** (bills coded to job and cost code, against commitment) | Subcontract/PO model | M / low; bill-pay rails L | A sub bill over the remaining commitment raises a warning; the committed balance updates |
| Expenses / receipts | SS+ GA (H) | Receipt capture praised (E112) | Scanner quality (E109–E110) | Yes (field) | Not coded to the job in the field | **Build** (mobile capture → job/cost code) | Mobile, OCR vendor (suggest only) | M / OCR per-page cost | A foreman photo receipt lands on job X / cost code Y pending approval |
| Reporting (standard) | SS+ GA (H). ~65+ reports in Plus (M). | Customizable | Reports move, slow (E076, E046) | Yes | Not job-centric | **Build** (job-centric core reports) | Data model | M / low | Every total drills down to source transactions |
| Advanced reports / custom report builder | A GA (M) | — | — | Some (CPA) | — | **Defer** | GL | M / low | — |
| Budgeting (company) | P+ GA (H). Balance-sheet budgets A-only (H). | — | — | Medium | — | **Defer** (job budgets in v1) | GL | M / low | — |
| Project profitability | P+ GA (H). Estimate-vs-actual A-only (Feb 2026, H). | — | Labor and payroll inconsistency (E070–E078) | Yes, critical | Unreliable labor | **Build** (estimate-native budgets) | Time, labor rates | M / low | Job report: estimate vs committed vs actual vs billed, ties to source docs to the cent |
| Inventory | P+ GA, FIFO (H) | Some praise | Advanced needs apps | Low for most trades | — | **Exclude** (v1–v2) | — | — | — |
| Classes / locations | P+ (capped at 40), A unlimited (H) | — | Cap hurts class-per-job users (E108) | Yes (as dimensions) | Caps | **Redesign** (job, phase, cost code dimensions, uncapped) | Data model | S / low | 500 jobs × 50 cost codes reportable without limits |
| Construction financials | **A GA (Aug 2026, US only)** (H) | — (no independent user feedback found yet) | Earlier add-on WIP accuracy complaint (E084) | Yes | Gated to the $340 tier | **Build** (core differentiator, included) | All of the above | L / low | Proposal → contract → CO → pay app → job cost → WIP, with no re-entry |
| Advanced project financials (WIP, cost-to-complete, committed costs) | A (cost-to-complete and WIP Sept 2026). Committed costs: A construction / IES (H). | — | PO non-posting historically (E079–E082) | Yes (GC, commercial) | Commitments invisible | **Build** | Subcontract/PO | M / low | WIP over/under = billed − (contract × cost-to-date ÷ est. total) per job |
| Tax workflows (sales tax) | SS+ automated sales tax (H) | — | Wrong rates, labor taxability (E117–E121) | Yes (state-dependent) | Errors | **Defer** (integrate a tax engine) | Tax engine vendor | M / per-transaction fees | — |
| 1099 | Tracking SS+. **E-file needs Payroll or Contractor Payments** (H). | — | E-file stalls, permissions (E122–E124) | Yes (subs) | Add-on gating | **Build tracking** (W-9 in sub directory); **partner for e-file** | Sub directory, e-file partner | S–M / per-form fees | Year-end vendor 1099 totals equal payments to 1099-flagged vendors |
| Employee time on invoices | E+ time tracking, billable time (H) | — | Labor hits P&L only when invoiced (E070). Can't group time (E058). | Yes (T&M, service) | — | **Build** (time → job/cost code, T&M invoice grouping) | Time entry | M / low | T&M invoice groups approved hours by cost code at contract rates |
| Batch transactions | A GA, up to 1,000 lines (M) | Desktop users value batch entry (E105) | — | Medium (bookkeepers) | — | **Build later** (grid entry for bills and time) | — | S / low | Paste 100 bill lines from a spreadsheet and validate |
| Spreadsheet export / sync | All tiers export. Spreadsheet Sync two-way in A (M). | — | — | Yes | — | **Build** (CSV/XLSX export every report); **Defer** two-way sync | — | S / low | Every report exports with identical totals |

### 3B. AI & automation (Intuit Assist / Intuit Intelligence / agents)

Official framing: **Intuit Intelligence is beta.** Chat is admin-only, usage is capped per account by plan, and it is available from QuickBooks Free through Advanced ([Intuit Fall 2026](https://quickbooks.intuit.com/r/product-update/whats-new-quickbooks-fall-2026/)). The agents (Accounting, Payments, Customer, Finance, Project Management, plus Sales Tax per some sources) went to a wider US rollout around July 2026 according to third parties. Plan gating comes from third parties only (**L**; superseded by the owner screenshot in §0, which places Accounting AI and Payments AI at Essentials, Sales Tax AI and Customer AI at Plus, and Project Management AI and Finance AI at Advanced):
- Accounting and Payments agents: E+
- Customer agent: P+
- Finance and Project Management agents: A

Intuit says users can turn off only bank-categorization AI and the Payroll Agent (E036).

| Capability | QBO support / plan / status (conf.) | Positive feedback | Negative feedback | Contractors need it? | Core pain | Rec | Dependencies | Impl. / Ongoing | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|
| AI onboarding | Intuit Intelligence / agents. Beta (L) | — | — | Low–medium | Setup effort | **Redesign** (trade presets, no AI needed) | Trade taxonomy | S / low | A new company chooses a trade and gets a cost-code template and dashboard |
| Financial Q&A (chat) | All plans, admin-only, beta, capped (M) | — | Distrust after false anomaly (E034 context) | Medium | — | **Defer** | GL, LLM | M / **LLM token cost** | Answers cite source transactions |
| Expense categorization | E+ Accounting agent, plus bank AI categorization (M) | — | "Gets most wrong", can't turn off (E034–E037) | Yes | Wrong auto-posts | **Redesign** (suggest-only, confidence, opt-in) | Feeds (v2) | M / LLM or ML cost | No suggestion posts without user confirmation; precision tracked |
| Bookkeeping cleanup | Accounting agent (L) | — | — | Medium | — | **Defer** | GL | — | — |
| Invoice drafting | "Invoicing on autopilot" beta with usage limits. ChatGPT/Claude invoice creation GA (M). | — | — | Yes | — | **Build deterministically** (proposal → invoice, no AI needed) | Contract | S / none | One click drafts pay app N from the SOV with the prior % prefilled |
| Payment reminders | Payments agent E+ (L). Standard reminders in all tiers. | — | — | Yes | Slow pay | **Build** (rule-based reminders) | Email/SMS | S / messaging cost | Reminders at −3/+7/+14 days, stopped on payment |
| Anomaly detection | Finance agent A (L) | — | False positive wasted a 928-transaction review (community, via E034 search) | Medium | — | **Defer** | GL history | M / compute | — |
| Budget scenarios | Finance agent A (L) | — | — | Low | — | **Exclude v1** | — | — | — |
| Forecasts (cash flow) | Finance agent A, beta (L) | — | — | Medium–high (cash crunch) | — | **Defer** (v2: AR schedule + committed AP forecast, deterministic) | GL, AP | M / low | 90-day cash forecast equals AR due + scheduled pay apps − committed AP |
| Quality checks (books review) | Accountant-side tools; month-end close pilot (M) | — | — | Medium (CPA) | — | **Defer** | GL | — | — |
| Project / cost allocation suggestions | PM agent A (sets up project from documents) (M) | — | — | Yes | Coding costs to jobs | **Build later** (suggest job/cost code for receipts and bills; human approves) | OCR, history | M / LLM cost | ≥90% top-3 accuracy on suggested job/cost code; nothing auto-posted |
| Customer follow-up | Customer agent P+ (L) | — | — | Medium | — | **Defer** (Built2Bid CRM/pipeline already exists, per brief) | — | — | — |
| Custom KPI dashboards | Finance agent / A (L) | — | Dashboard redesign backlash (E042) | Yes | — | **Build** (fixed, trade-tuned cards, customizable) | Reports | M / low | Admin can reorder and hide cards; essential alerts can't be hidden |

### 3C. Enterprise operations

| Capability | QBO support / plan / status (conf.) | Positive | Negative | Contractors need it? | Core pain | Rec | Deps | Impl. / Ongoing | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|
| User permissions | Preset roles all tiers. **Custom roles A/IES only** (H). User caps 1/3/5/25. | — | Plus roles complaint (E107) | Yes | Field staff vs financials | **Build** (role templates in all tiers, job-scoped) | Auth | M / low | A foreman can submit time and receipts but cannot open AR, P&L or other jobs |
| Approval workflows | A GA (invoices, bills) (M) | — | — | Yes (bills, COs, POs) | — | **Build** (bill, CO, PO approvals) | Roles | M / low | A bill over $X requires PM approval before it can be paid |
| Automation rules | Bank rules all tiers. Workflow automation A (M). | Praised (E031) | — | Yes | — | **Build later** (bank rules in v2; reminders in v1) | — | M / low | — |
| Accountant access | Free accountant seat. QBOA retires 2026-12-31 → Intuit Accountant Suite (H). | Strong praise (E134) | Undo-reconciliation accountant-only (E026) | Yes | — | **Build** (free accountant role, exports, later workspace) | Roles, exports | M / low | An invited CPA sees GL/AR/AP/WIP read-only, plus export packs |
| Management reporting | A (management reports) (M) | — | — | Medium | — | **Defer** | GL | M / low | — |
| Multi-dimension reporting | Classes/locations (P capped), Dimensions in IES (M) | — | Caps (E108) | Yes (job, phase, cost code, trade) | — | **Build** (core data model) | — | M / low | Report by any combination of project, phase, cost code and trade |
| Integrations | Very large app ecosystem (M) | E136 | — | Yes | — | **Build** QBO/Xero sync (v1); public API later | — | L / API maintenance | A QBO sync round-trip leaves no orphaned or duplicated records |

---

## 4. Takeaways for Built2Bid [researcher inference]
1. **QBO Advanced is now a real construction competitor**, but at **$340/mo (reported)**, US-only, with retainage and SOV pushed to IES (beta) and job hierarchies "coming soon". Built2Bid can include contract-native construction billing in a far cheaper plan.
2. Intuit's construction workflow starts from a QBO estimate. **Built2Bid's advantage is upstream:** the signed, e-signed proposal and change orders already exist, so the contract, SOV and budget need no re-entry.
3. **Don't compete on generic AI.** QBO's AI is beta, capped, and draws complaints for being imposed. Deterministic, construction-specific automation (proposal → pay app, CO → budget) is more trustworthy.
4. Highest operating-cost items to plan for: bank-feed aggregator fees (v2), payments ops and risk, OCR/LLM usage, sales-tax engine fees, 1099 e-file per-form fees.
