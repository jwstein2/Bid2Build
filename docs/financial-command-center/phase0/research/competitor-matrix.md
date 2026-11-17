# Competitor Capability Matrix: Built2Bid Financial Command Center (Phase 0)

Prepared: 2026-11-17 · Agent 1. This compares capabilities; it does not rank products.

**How to read this**
- **Y** = supported natively.
- **P** = partial, or only through a workaround.
- **N** = not supported.
- **Add-on** = costs extra or sits in a higher tier.
- **Sync** = handled by syncing to a connected accounting system.
- **?** = not verified this session.

**Sources.** Everything comes from search-result summaries of public pages. I could not open pages directly in this session (fetch was blocked). Vendor pricing pages often weren't reachable, so most prices are third-party and marked **(3P)**. Competitor-authored claims are marked **(comp)**. Verify before using any of this externally.

---

## 1. Matrix: billing and contract

| Product | Invoices | Progress billing | Retainage | Change orders tied to contract value | AIA-style pay app / SOV |
|---|---|---|---|---|---|
| **QBO** (SS/E/P/A) | Y | P (E+ estimate-based, capped at 100% of the original estimate). **A: AIA-style by phase** ([Intuit](https://quickbooks.intuit.com/r/product-update/whats-new-quickbooks-advanced-august-2026/)) | P (manual negative line). A: not confirmed. IES: beta ([IES](https://erp.intuit.com/construction/)) | **A: Y** (approval updates estimate, budget and invoice, Aug 2026). P and below: workaround | A: "AIA-style" (not AIA-certified). SOV/G702/G703: IES beta |
| **QB Desktop / Enterprise** | Y | Y (progress invoicing from estimates; Contractor edition) | P (retainage items) | P (community advice: separate job per CO) ([Intuit community](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/progress-invoicing/00/674048)) | P / ? |
| **Xero** | Y | **N** natively. Can't partially invoice a quote ([Xero ideas](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/44961052-quotes-copy-partial-quote-to-an-invoice)) | N (negative-line workaround) ([Xero ideas](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/45636571-sales-invoices-ability-to-specify-a-of-invoice)) | N | N |
| **FreshBooks** | Y | ? (retainers / deposits) | N? | N | N |
| **Zoho Books** | Y | **Y**: progress invoices from quotes by %, amount or line, all paid plans ([Zoho help](https://www.zoho.com/books/help/quote/progress-invoice.html)) | N? | P | N |
| **Wave** | Y | N | N | N | N |
| **Sage 50** | Y | P (Premium+ job costing) ([Sage 50 pricing](https://www.capterra.com/p/174753/Sage-50cloud/pricing/)) | ? | P | ? |
| **Sage 100 Contractor** | Y | **Y**: SOV % per line, imported from budget or proposal; overbilling warning in 2026.3 ([Sage help](https://help-sage100contractor.na.sage.com/Sage100Contractor/US/23_2/Content/Modules/3-Accounts_Receivable/AIA_Certificates.htm)) | **Y**: AR retention at the job rate, AP retention at the subcontract rate ([Sage help](https://help-sage100contractor.na.sage.com/Sage100Contractor/US/23_1/Content/Modules/3-Accounts_Receivable/About_progress_billing_retention.htm)) | **Y** (6-4 change orders, prime and sub changes) ([Sage help](https://help-sage100contractor.na.sage.com/Sage100Contractor/US/25_1/Content/Modules/6-Project_Management/Entering_prime_and_sub_changes_for_contracts_and_budgets.htm)) | **Y**: prints on purchased AIA G702/G703 forms |
| **Sage Intacct Construction** | Y | Y | Y | Y | Y (via modules/ISVs per critics) ([erpresearch](https://erpresearch.com/en-us/sage-intacct-for-construction)) |
| **JobTread** | Y | Y (3P) ([GetApp](https://www.getapp.com/construction-software/a/jobtread/)) | **Y** (product update "retainage and hold-backs", Sept 2025; contents not read) ([JobTread](https://www.jobtread.com/product-updates/2025-09-03-retainage-and-hold-backs)) | Y | P (AIA pay applications mentioned by a listing) |
| **Buildertrend** | Y | Y | ? | Y (Advanced+ tier) ([costbench](https://www.costbench.com/software/construction-management/buildertrend/)) | ? |
| **Contractor Foreman** | Y | Y (Plus+) | Y (Plus+) | Y | "AIA-style" formatting (comp: Knowify) ([agiled](https://agiled.app/blog/best-invoicing-software-for-construction)) |
| **Knowify** | Y | Y (AIA billing) | ? | Y | Y (3P) |
| **Procore** | Owner invoices | Y (Progress Billings) | **Y** (prime and commitments; set and release) ([Procore support](https://support.procore.com/products/online/user-guide/project-level/progress-billings?mt-view=f1)) | Y | Y (SOV on owner invoices) |
| **Houzz Pro** | Y | P (payment schedules) ? | ? | ? | N? |
| **Built2Bid v1 (proposed)** | **Y, from signed proposal** | **Y, against revised contract** | **Y, AR + AP sub-ledgers** | **Y, CO → SOV + budget (no re-entry)** | **"AIA-style" G702/G703-format pay app (no AIA licensing claim)** |

## 2. Matrix: job cost and accounting

| Product | Job costing (actual vs estimate) | Committed costs / POs / subcontracts | Sub bills | Bank feeds | Reconciliation | Double-entry GL | AR/AP aging | QBO sync | Mobile receipt capture |
|---|---|---|---|---|---|---|---|---|---|
| **QBO** | P+ project profitability. **Estimate-vs-actual: A only** (Feb 2026) | A construction/IES: Committed Costs report. Elsewhere POs are non-posting (E079) | Y (E+) | Y (duplicate and drift complaints) | Y | Y | Y | n/a | Y (quality complaints) |
| **QB Desktop / Enterprise** | Y (job estimates vs actuals) | P (POs; Enterprise more) | Y | Y (Desktop 2023 ended 2026-05-31) | Y | Y | Y | n/a | P |
| **Xero** | P (Projects on Established plan only) ([3P](https://www.activepieces.com/blog/xero-pricing-plans-compared-costs-and-fees-in-2026.md)) | P (POs, no commitment reporting) | Y | Y | Y | Y | Y | n/a | Y |
| **FreshBooks** | P (project profitability) | N | Y | Y | Y | Y | Y | n/a | Y |
| **Zoho Books** | P (projects, time) | P (POs) | Y | Y | Y | Y | Y | n/a | Y |
| **Wave** | N | N | Y | **Pro only** since 2026 ([beancount](https://beancount.io/blog/2026/08/05/wave-accounting-bank-feeds-collaborator-paywall-guide)) | Y | Y | Y | n/a | Y |
| **Sage 50** | Y (Premium+) | P | Y | Y | Y | Y | Y | n/a | P |
| **Sage 100 Contractor** | **Y**: cost code × cost type, CSI divisions, budget checks on timecards ([Sage doc](https://docs.sage.com/docs/en/customer/100contractor/27_1US/open/Sage100ContractorandYourBusiness.pdf)) | **Y**: POs and subcontract POs feed committed costs; sub change orders | Y (subcontract retention, compliance warnings, lien waivers) | P (on-prem; bank rec Y) | Y | Y | Y | n/a | P (on-prem; mobile via add-ons) |
| **Sage Intacct Construction** | Y | Y | Y | Y | Y | Y | Y | n/a | Y |
| **JobTread** | **Y**: line-item budgets from estimates, cost vs estimate, WIP | Y (POs/bills) | Y | N (Sync) | N (Sync) | **N (Sync to QBO/QBD)** | P | **Y (two-way QBO + QBD)** | Y |
| **Buildertrend** | Y | Y (POs) | Y | N (Sync) | N (Sync) | **N**: "not a GL" ([erpresearch](https://erpresearch.com/erp-add-ons/construction/buildertrend)) | P | **Y (two-way QBO, QBD, Xero)** | Y |
| **Contractor Foreman** | Y | Y (POs) | Y | N | N | N | P | Y (two-way per erpresearch; Zapier per Knowify (comp)) | Y |
| **Knowify** | Y | Y | Y | N | N | N | P | Y (QBO, QBO Advanced, IES at launch) | Y |
| **Procore** | Y (budget, commitments) | **Y** (commitments, sub invoices) | Y (Procore Pay) | N | N | N (ERP integrations) | P | Integrations | Y |
| **Houzz Pro** | P | P | P | N | N | N | P | P (one-way vs two-way disputed) | Y |
| **Built2Bid v1 (proposed)** | **Y, budget = signed estimate by cost code** | **Y, subcontracts/POs from estimate lines + sub directory** | **Y, against commitment** | v2 | v2 | v2 | **Y (AR v1; AP v1)** | **Y (v1)** | **Y** |

## 3. Matrix: payments, pricing and users

| Product | Payments processing and fees (reported) | Pricing (reported, USD/mo) | User limits |
|---|---|---|---|
| **QBO** | Card ~2.99% invoice, ACH 1% (cap disputed) ([weaudit](https://www.weaudit.com/ratings/quickbooks-payments/quickbooks-payments-fees/)) | SS $38 · E $85 · P $140 · A $340 (after 2026-08-01, 3P) | 1 / 3 / 5 / 25 |
| **QB Desktop Enterprise** | QB Payments | Quote / tiered (Silver–Diamond). One source: Desktop ~$1,149/yr + $230/seat (3P, unclear which product) | by license |
| **Xero** | Stripe/GoCardless etc. | Early $27 · Growing $59 · Established $97 (from 2026-10-01, 3P) ([sdocpa](https://www.sdocpa.com/?p=4445)). Early caps: 20 invoices, 5 bills per month. | Unlimited users |
| **FreshBooks** | FreshBooks Payments | Lite ~$23 · Plus ~$43 · Premium ~$70 (3P, Jan 2026 increase) ([costbench](https://costbench.com/compare/freshbooks-vs-zoho-books/)) | Extra users paid |
| **Zoho Books** | Zoho Payments / gateways | Free · Standard ~$20 · Professional ~$50 · Ultimate ~$275 (3P; tiers vary) ([temperstack](https://www.temperstack.com/plans/zoho-books/)) | Tiered |
| **Wave** | 2.9% + $0.60 card; ACH 1% ($1 min) disputed | Starter free · Pro $19 ($190/yr) (3P) | — |
| **Sage 50** | Sage Payments | Pro ~$132 · Premium ~$183 · Quantum ~$271 per month (3P, Oct 2026) | by tier |
| **Sage 100 Contractor** | — | Quote. ~$115–$200/user/mo plus $5k–$25k implementation (ContractorToolStack editorial) ([CTS](https://contractortoolstack.com/software/sage-construction/)) | per seat |
| **Sage Intacct Construction** | — | Quote. ~$400–$800/user/mo est. (3P) | per user |
| **JobTread** | Stripe: e.g. $2,000 invoice ≈ $59.30 card / $15 ACH ([JobTread](https://www.jobtread.com/collect-payments)) | $199 first user + $20/user monthly; ~$159 annual (3P) | per user |
| **Buildertrend** | Bill Pay: ACH $1, check $2 (contractor pays) ([Buildertrend](https://buildertrend.com/help-article/buildertrend-payments-faqs/)) | Quote. Reported $339–$1,099/mo by tier/source (3P). Anecdotal 50–65% renewal increases (comp). | Unlimited users (per some sources) |
| **Contractor Foreman** | ? | Basic $49 · Standard $105 · Plus $166 · Pro ~$221 · Unlimited $332 (annual, 3P/comp) | per tier |
| **Knowify** | ? | ~$99–$374 (3P, conflicting) | ? |
| **Procore** | Procore Pay (GC SaaS fee and/or sub platform fee) ([Procore](https://support.procore.com/products/online/procore-pay/faq/what-fee-models-does-procore-offer-to-payors-using-procore-pay)) | Quote, based on annual construction volume ("five figures/yr minimum", 3P) | Unlimited users |
| **Houzz Pro** | Houzz payments | $89 to $399/mo (Capterra, conflicting) | ? |
| **Built2Bid FCC** | TBD (ACH-first) | Per V3 addendum: **$24.99 incl. 3 seats, +$4.99/seat**, no trade tiers | FCC seats separate |

---

## 4. Who already solves what
- **Contract-grade progress billing, retainage, SOV/pay apps, WIP, committed costs:** Sage 100 Contractor, Sage Intacct Construction and Procore (mid-market, expensive). JobTread, Contractor Foreman and Knowify cover the residential and trade SMB segment, but all of them **sync to QuickBooks for the GL**. QBO Advanced now covers much of this at $340/mo, with retainage and SOV still in IES beta.
- **General ledger and bank feeds:** QBO, Xero, Zoho, FreshBooks, Wave and Sage. None of the SMB GL products models a construction contract well. Zoho is closest on progress invoicing.
- **Gap in the market [INF]:** no product serves a small contractor (under ~$5M) with **estimate → signed proposal → contract/SOV → CO → pay app with retainage → job cost and WIP** in one system, **at SMB pricing, without re-keying**. Today the PM tools (JobTread, Buildertrend) require a QBO subscription alongside them.

## 5. Built2Bid's structural advantage
1. **Financials flow from the signed contract.** Built2Bid already holds the estimate lines, the e-signed proposal and the change orders. The SOV, budget and billing schedule can be generated, not typed. Competitors either start at the estimate inside the accounting tool (QBO) or re-sync an estimate into accounting (JobTread, Buildertrend).
2. **Sub directory → commitments.** Subcontracts and POs can be issued from estimate lines to subs already in the directory. Sub retainage, compliance documents and 1099 data then live on the same vendor record.
3. **Price.** The FCC at $24.99 with 3 seats (owner addendum) is a fraction of QBO Advanced ($340), JobTread ($199+) or Buildertrend ($339+), assuming payments and other add-ons fund the economics [INF].
4. **One ledger later.** The PM tools can't become the GL without a rebuild. Built2Bid's v2 GL can sit directly on contract objects.
