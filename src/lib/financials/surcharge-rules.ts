/**
 * Credit card surcharge rules for the 50 states, DC and Puerto Rico. Researched and checked against primary sources
 * on 2026-11-21 (statutes, attorney general / regulator guidance, controlling court decisions). Not legal advice:
 * laws change, and counsel should review before relying on this. Update RULES_VERIFIED_ON whenever this changes.
 *
 * status: "allowed" (network rules apply: credit only, at most 3%, at cost, disclosed), "capped" (a state cap below
 * 3%), "banned", or "unclear" (a ban still on the books or contested; treated as banned). Card network rules and the
 * cost-of-acceptance cap are applied in surcharge.ts for every state.
 * Full write-up with every citation: docs/financials/card-surcharge-rules.md.
 */
export const RULES_VERIFIED_ON = "2026-11-21";

export interface StateRule {
  name: string;
  status: "allowed" | "capped" | "banned" | "unclear";
  /** State percentage cap, when below or alongside the 3% network cap. */
  capPct?: number;
  /** State-required wording added to the customer-facing disclosure. */
  disclosure?: string;
  summary: string;
  sources: { label: string; url: string }[];
  /** How sure the research is: high = primary text read; medium = official guidance or several agreeing sources; low = thin. */
  confidence: "high" | "medium" | "low";
}

export const STATE_RULES: Record<string, StateRule> = {
  AK: {
    name: "Alaska",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  AL: {
    name: "Alabama",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  AR: {
    name: "Arkansas",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed). The Attorney General says the surcharge must be disclosed before the transaction.",
    sources: [{ label: "Arkansas Attorney General, consumer finance guidance", url: "https://arkansasag.gov/divisions/public-protection/finances/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  AZ: {
    name: "Arizona",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  CA: {
    name: "California",
    status: "unclear",
    summary: "Civ. Code 1748.1 bans retailer credit card surcharges on consumers; Italian Colors v. Becerra (9th Cir. 2018) struck it only as applied to the plaintiffs, and SB 478 (from July 1, 2024) requires all-in prices. Too risky for consumer invoices: Built2Bid doesn't surcharge in California. Offer a bank-payment discount instead.",
    sources: [{ label: "California AG on Civ. Code 1748.1 and Italian Colors", url: "https://oag.ca.gov/node/38842" }, { label: "California AG SB 478 FAQ", url: "https://oag.ca.gov/system/files/attachments/press-docs/SB%20478%20FAQ%20%28B%29.pdf" }],
    confidence: "medium",
  },
  CO: {
    name: "Colorado",
    status: "capped",
    capPct: 2,
    disclosure: "TO COVER THE COST OF PROCESSING A CREDIT OR CHARGE CARD TRANSACTION, AND PURSUANT TO SECTION 5-2-212, COLORADO REVISED STATUTES, A SELLER OR LESSOR MAY IMPOSE A PROCESSING SURCHARGE IN AN AMOUNT NOT TO EXCEED 2% OF THE TOTAL PAYMENT MADE FOR GOODS OR SERVICES PURCHASED OR LEASED BY USE OF A CREDIT OR CHARGE CARD. A SELLER OR LESSOR SHALL NOT IMPOSE A PROCESSING SURCHARGE ON PAYMENTS MADE BY USE OF CASH, A CHECK, OR A DEBIT CARD OR REDEMPTION OF A GIFT CARD.",
    summary: "C.R.S. 5-2-212 (SB 21-091, from July 1, 2022): at most 2% (or the actual merchant discount fee), statutory notice before payment, separate receipt line, never on debit. Consumer sales; total-price rules (C.R.S. 6-1-737) from Jan 1, 2026.",
    sources: [{ label: "Colorado SB 21-091 (C.R.S. 5-2-212)", url: "https://content.leg.colorado.gov/sites/default/files/documents/2021A/bills/2021a_091_rev.pdf" }],
    confidence: "high",
  },
  CT: {
    name: "Connecticut",
    status: "banned",
    summary: "C.G.S. 42-133ff (amended by PA 24-142): no person may impose a surcharge on any transaction, including business customers and any payment method. Cash or bank discounts are allowed if posted.",
    sources: [{ label: "C.G.S. 42-133ff; CT DCP surcharge FAQ", url: "https://portal.ct.gov/dcp/knowledge-base/articles/surcharge-faqs/what-is-the-connecticut-surcharge-law" }],
    confidence: "high",
  },
  DC: {
    name: "District of Columbia",
    status: "allowed",
    summary: "No surcharge statute. D.C. Law 26-187 (effective Sept 26, 2026, D.C. Code 28-3904(a)(12)) bans prices that leave out mandatory fees; the card total is shown before payment and bank payment avoids the fee.",
    sources: [{ label: "D.C. Law 26-187", url: "https://code.dccouncil.gov/us/dc/council/laws/26-187" }],
    confidence: "medium",
  },
  DE: {
    name: "Delaware",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  FL: {
    name: "Florida",
    status: "allowed",
    summary: "Fla. Stat. 501.0117 still bans surcharges on paper, but the 11th Circuit held it unconstitutional (Dana's Railroad Supply v. Attorney General, 807 F.3d 1235, 2015). Allowed with up-front disclosure under network rules.",
    sources: [{ label: "Fla. Stat. 501.0117", url: "https://www.flsenate.gov/Laws/Statutes/2025/501.0117" }, { label: "Dana's Railroad Supply v. AG of Florida, 807 F.3d 1235 (11th Cir. 2015)", url: "https://media.ca11.uscourts.gov/opinions/pub/files/201414426.pdf" }],
    confidence: "medium",
  },
  GA: {
    name: "Georgia",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed). State consumer guidance: no more than the merchant's cost, notice before the sale, exact amount on the receipt.",
    sources: [{ label: "Georgia Consumer Protection Division, Ask Ed (Aug 20, 2024)", url: "https://consumered.georgia.gov/ask-ed/2024-08-20/are-merchants-allowed-profit-credit-card-surcharges" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  HI: {
    name: "Hawaii",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  IA: {
    name: "Iowa",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  ID: {
    name: "Idaho",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  IL: {
    name: "Illinois",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed). Pending bills (SB1931, HB4592) were not law as of Nov 2026.",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  IN: {
    name: "Indiana",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  KS: {
    name: "Kansas",
    status: "allowed",
    summary: "K.S.A. 16a-2-403 (as amended by L. 2024 ch. 6, effective Jan 1, 2025) allows a credit card surcharge with clear and conspicuous notice of the amount before the transaction.",
    sources: [{ label: "K.S.A. 16a-2-403", url: "https://www.ksrevisor.gov/statutes/chapters/ch16a/016a_002_0403.html" }],
    confidence: "high",
  },
  KY: {
    name: "Kentucky",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  LA: {
    name: "Louisiana",
    status: "allowed",
    summary: "No credit card surcharge law. Act 751 of 2026 (R.S. 51:3081-3082) bans debit card surcharges from Aug 1, 2026, including business customers; Built2Bid never surcharges debit.",
    sources: [{ label: "Louisiana Act 751 (2026), SB 254 enrolled", url: "https://legis.la.gov/Legis/ViewDocument.aspx?d=1477500" }],
    confidence: "high",
  },
  MA: {
    name: "Massachusetts",
    status: "banned",
    summary: "M.G.L. c.140D 28A: no seller may impose a surcharge on a cardholder who pays by credit card. Cash discounts are allowed if offered to all and disclosed.",
    sources: [{ label: "M.G.L. c.140D 28A", url: "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXX/Chapter140D/Section28A" }],
    confidence: "high",
  },
  MD: {
    name: "Maryland",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed). Com. Law 12-509 protects cash discounts; no verified surcharge cap.",
    sources: [{ label: "Md. Code, Com. Law 12-509", url: "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=12-509" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "low",
  },
  ME: {
    name: "Maine",
    status: "banned",
    summary: "9-A M.R.S. 8-509: a seller may not surcharge credit or debit card payments (only government entities may). LD 151 (2025) to allow surcharges died.",
    sources: [{ label: "9-A M.R.S. 8-509", url: "https://legislature.maine.gov/statutes/9-A/title9-Asec8-509.html" }],
    confidence: "high",
  },
  MI: {
    name: "Michigan",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed). The Attorney General says Michigan has no law restricting card surcharges. Michigan Treasury treats surcharges as part of the taxable sale.",
    sources: [{ label: "Michigan AG consumer alert: credit and debit card surcharges", url: "https://www.michigan.gov/consumerprotection" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  MN: {
    name: "Minnesota",
    status: "allowed",
    capPct: 5,
    summary: "Minn. Stat. 325G.051 allows up to 5% with conspicuous notice during the sale (online: order summary or checkout page). Network rules hold it to 3%.",
    sources: [{ label: "Minn. Stat. 325G.051", url: "https://www.revisor.mn.gov/statutes/cite/325G.051" }],
    confidence: "high",
  },
  MO: {
    name: "Missouri",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  MS: {
    name: "Mississippi",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  MT: {
    name: "Montana",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  NC: {
    name: "North Carolina",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  ND: {
    name: "North Dakota",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  NE: {
    name: "Nebraska",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed). Neb. Rev. Stat. 81-118.01 (cost cap) covers state agencies only.",
    sources: [{ label: "Neb. Rev. Stat. 81-118.01", url: "https://nebraskalegislature.gov/laws/statutes.php?statute=81-118.01" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  NH: {
    name: "New Hampshire",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  NJ: {
    name: "New Jersey",
    status: "allowed",
    summary: "P.L.2023, c.146 (N.J.S.A. 56:8-156.1, effective Aug 18, 2023): surcharge may not exceed the seller's actual processing cost, and its amount must be shown clearly on the checkout page before payment.",
    sources: [{ label: "N.J. P.L.2023, c.146", url: "https://pub.njleg.gov/Bills/2022/PL23/146_.HTM" }],
    confidence: "high",
  },
  NM: {
    name: "New Mexico",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  NV: {
    name: "Nevada",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed). Keep the surcharge at or below cost (deceptive trade practices law, NRS 598).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "low",
  },
  NY: {
    name: "New York",
    status: "allowed",
    disclosure: "Card totals shown include the surcharge.",
    summary: "GBL 518 (amended, effective Feb 11, 2024): surcharge may not exceed what the card company charges, and the total price including the surcharge must be shown before payment (a bare '+X%' notice is not enough).",
    sources: [{ label: "N.Y. Gen. Bus. Law 518", url: "https://www.nysenate.gov/legislation/laws/GBS/518" }, { label: "NY Department of State guidance", url: "https://dos.ny.gov/node/60266" }],
    confidence: "high",
  },
  OH: {
    name: "Ohio",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  OK: {
    name: "Oklahoma",
    status: "capped",
    capPct: 2,
    summary: "SB 677 (2025, effective Nov 1, 2025) replaced the old ban (14A O.S. 2-211): credit cards only, at most 2% or actual cost, only if other payment methods are accepted, clear notice on the checkout page.",
    sources: [{ label: "Oklahoma SB 677 (2025) enrolled", url: "https://www.oklegislature.gov/cf_pdf/2025-26%20ENR/SB/SB677%20ENR.PDF" }],
    confidence: "high",
  },
  OR: {
    name: "Oregon",
    status: "allowed",
    summary: "No surcharge statute. SB 430 (2025, effective Jan 1, 2026) requires online prices to include required fees; the card total is shown before payment and bank payment avoids the fee.",
    sources: [{ label: "Oregon SB 430 (2025)", url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB430" }],
    confidence: "medium",
  },
  PA: {
    name: "Pennsylvania",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  PR: {
    name: "Puerto Rico",
    status: "banned",
    summary: "Law 150-2008 as amended by Law 152-2013 (10 LPRA 11) bans card surcharges; upheld by the First Circuit on May 29, 2025.",
    sources: [{ label: "Asociacion de Detallistas de Gasolina de P.R. v. Puerto Rico (1st Cir. May 29, 2025)", url: "https://www.ca1.uscourts.gov/" }],
    confidence: "high",
  },
  RI: {
    name: "Rhode Island",
    status: "allowed",
    summary: "No surcharge statute. A 2025 total-price law (H5247/S0017) requires mandatory fees in the price; the card total is shown before payment and bank payment avoids the fee.",
    sources: [{ label: "Rhode Island H5247 (2025)", url: "https://status.rilegislature.gov/" }],
    confidence: "medium",
  },
  SC: {
    name: "South Carolina",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  SD: {
    name: "South Dakota",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed). Attorney General guidance: no more than the merchant's cost, disclosed before payment, amount shown on the receipt.",
    sources: [{ label: "South Dakota AG Consumer Protection, credit card surcharges", url: "https://consumer.sd.gov/fastfacts/credit.aspx" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  TN: {
    name: "Tennessee",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  TX: {
    name: "Texas",
    status: "unclear",
    summary: "Bus. & Com. Code 604A.0021 still bans credit card surcharges; Rowell v. Paxton (W.D. Tex. 2018) enjoined it only for the plaintiff merchants and AG Opinion KP-0257 (2019) treats it as enforceable otherwise. Built2Bid doesn't surcharge in Texas. Cash or bank discounts are allowed.",
    sources: [{ label: "Tex. Bus. & Com. Code 604A.0021", url: "https://law.justia.com/codes/texas/business-and-commerce-code/title-12/chapter-604a/section-604a-0021" }, { label: "Texas AG Opinion KP-0257 (June 14, 2019)", url: "https://www.texasattorneygeneral.gov/opinions/ken-paxton/kp-0257" }],
    confidence: "medium",
  },
  UT: {
    name: "Utah",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed). Utah's 2013 surcharge ban (Utah Code 13-38a-302) expired June 30, 2014.",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  VA: {
    name: "Virginia",
    status: "allowed",
    summary: "No surcharge cap. Va. Code 59.1-607 to -610 (from July 1, 2025) require displayed prices to include mandatory fees; a card surcharge the customer can avoid by paying by bank is optional, and the card total is shown before payment.",
    sources: [{ label: "Va. Code Title 59.1 ch. 58", url: "https://law.lis.virginia.gov/vacodefull/title59.1/chapter58/" }],
    confidence: "medium",
  },
  VT: {
    name: "Vermont",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  WA: {
    name: "Washington",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "MRSC (Washington local government research), credit card surcharges", url: "https://mrsc.org/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  WI: {
    name: "Wisconsin",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  WV: {
    name: "West Virginia",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
  WY: {
    name: "Wyoming",
    status: "allowed",
    summary: "No state law limits credit card surcharges; card network rules apply (credit only, up to 3%, at cost, disclosed).",
    sources: [{ label: "NFIB Legal Center, state surcharge guide (2025)", url: "https://www.nfib.com/news/legal/" }, { label: "Visa U.S. Merchant Surcharge Q&A (Feb 2024)", url: "https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf" }],
    confidence: "medium",
  },
};
