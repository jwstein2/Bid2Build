/**
 * Official state tax authorities: all 50 states + the District of Columbia (V6.9).
 *
 * This file is the source of truth for public.tax_authorities (a DB test keeps the seed in
 * supabase/migrations/20261226001000_tax_banking.sql in sync with it).
 *
 * Rules (from the V6.9 spec):
 *   - Agency names and homepages only. No invented feeds, APIs or deep links: `rateUrl` stays null until someone
 *     confirms the page on the agency's own site.
 *   - `system` describes what kind of tax the state levies, so the app never assumes every state has a general
 *     statewide sales tax (AK, DE, MT, NH, OR have none; HI, NM levy gross receipts taxes; AZ levies a
 *     transaction privilege tax with its own contracting classifications).
 *   - Every record starts as `needs_verification`. The daily tax job marks a record `reachable` after its homepage
 *     answers (that proves the URL works, not that a rate is current). Rates themselves come only from the licensed
 *     tax provider. Where a state publishes no machine-readable feed, the job opens a review task instead of
 *     pretending an integration exists.
 *   - `sst`: full member of the Streamlined Sales and Use Tax Agreement (relevant to provider pricing and
 *     certified service providers).
 */
export type TaxSystem = "sales_use" | "gross_receipts" | "transaction_privilege" | "local_only" | "none";

export interface TaxAuthority {
  state: string;
  stateName: string;
  authority: string;
  website: string;
  system: TaxSystem;
  sst: boolean;
  /** Notes that matter for construction: shown as context, never as a legal conclusion. */
  note?: string;
}

export const TAX_AUTHORITIES: readonly TaxAuthority[] = [
  { state: "AL", stateName: "Alabama", authority: "Alabama Department of Revenue", website: "https://www.revenue.alabama.gov/", system: "sales_use", sst: false, note: "Many cities and counties administer their own sales taxes." },
  { state: "AK", stateName: "Alaska", authority: "Alaska Department of Revenue", website: "https://tax.alaska.gov/", system: "local_only", sst: false, note: "No statewide sales tax. Some boroughs and cities levy local sales taxes." },
  { state: "AZ", stateName: "Arizona", authority: "Arizona Department of Revenue", website: "https://azdor.gov/", system: "transaction_privilege", sst: false, note: "Transaction privilege tax with separate contracting classifications. Review contract treatment." },
  { state: "AR", stateName: "Arkansas", authority: "Arkansas Department of Finance and Administration", website: "https://www.dfa.arkansas.gov/", system: "sales_use", sst: true },
  { state: "CA", stateName: "California", authority: "California Department of Tax and Fee Administration", website: "https://www.cdtfa.ca.gov/", system: "sales_use", sst: false, note: "District taxes vary within cities and counties." },
  { state: "CO", stateName: "Colorado", authority: "Colorado Department of Revenue", website: "https://tax.colorado.gov/", system: "sales_use", sst: false, note: "Home-rule cities may collect their own sales and use taxes." },
  { state: "CT", stateName: "Connecticut", authority: "Connecticut Department of Revenue Services", website: "https://portal.ct.gov/drs", system: "sales_use", sst: false },
  { state: "DE", stateName: "Delaware", authority: "Delaware Division of Revenue", website: "https://revenue.delaware.gov/", system: "none", sst: false, note: "No sales tax. Delaware levies a gross receipts tax on businesses." },
  { state: "DC", stateName: "District of Columbia", authority: "DC Office of Tax and Revenue", website: "https://otr.cfo.dc.gov/", system: "sales_use", sst: false },
  { state: "FL", stateName: "Florida", authority: "Florida Department of Revenue", website: "https://floridarevenue.com/", system: "sales_use", sst: false },
  { state: "GA", stateName: "Georgia", authority: "Georgia Department of Revenue", website: "https://dor.georgia.gov/", system: "sales_use", sst: true },
  { state: "HI", stateName: "Hawaii", authority: "Hawaii Department of Taxation", website: "https://tax.hawaii.gov/", system: "gross_receipts", sst: false, note: "General excise tax on the business, not a retail sales tax." },
  { state: "ID", stateName: "Idaho", authority: "Idaho State Tax Commission", website: "https://tax.idaho.gov/", system: "sales_use", sst: false },
  { state: "IL", stateName: "Illinois", authority: "Illinois Department of Revenue", website: "https://tax.illinois.gov/", system: "sales_use", sst: false },
  { state: "IN", stateName: "Indiana", authority: "Indiana Department of Revenue", website: "https://www.in.gov/dor/", system: "sales_use", sst: true },
  { state: "IA", stateName: "Iowa", authority: "Iowa Department of Revenue", website: "https://revenue.iowa.gov/", system: "sales_use", sst: true },
  { state: "KS", stateName: "Kansas", authority: "Kansas Department of Revenue", website: "https://www.ksrevenue.gov/", system: "sales_use", sst: true },
  { state: "KY", stateName: "Kentucky", authority: "Kentucky Department of Revenue", website: "https://revenue.ky.gov/", system: "sales_use", sst: true },
  { state: "LA", stateName: "Louisiana", authority: "Louisiana Department of Revenue", website: "https://revenue.louisiana.gov/", system: "sales_use", sst: false, note: "Parish (local) sales taxes are administered locally." },
  { state: "ME", stateName: "Maine", authority: "Maine Revenue Services", website: "https://www.maine.gov/revenue/", system: "sales_use", sst: false },
  { state: "MD", stateName: "Maryland", authority: "Comptroller of Maryland", website: "https://www.marylandtaxes.gov/", system: "sales_use", sst: false },
  { state: "MA", stateName: "Massachusetts", authority: "Massachusetts Department of Revenue", website: "https://www.mass.gov/orgs/massachusetts-department-of-revenue", system: "sales_use", sst: false },
  { state: "MI", stateName: "Michigan", authority: "Michigan Department of Treasury", website: "https://www.michigan.gov/treasury", system: "sales_use", sst: true },
  { state: "MN", stateName: "Minnesota", authority: "Minnesota Department of Revenue", website: "https://www.revenue.state.mn.us/", system: "sales_use", sst: true },
  { state: "MS", stateName: "Mississippi", authority: "Mississippi Department of Revenue", website: "https://www.dor.ms.gov/", system: "sales_use", sst: false, note: "Contractor's tax applies to some construction contracts. Review contract treatment." },
  { state: "MO", stateName: "Missouri", authority: "Missouri Department of Revenue", website: "https://dor.mo.gov/", system: "sales_use", sst: false },
  { state: "MT", stateName: "Montana", authority: "Montana Department of Revenue", website: "https://mtrevenue.gov/", system: "none", sst: false, note: "No general sales tax. Some resort areas levy local resort taxes." },
  { state: "NE", stateName: "Nebraska", authority: "Nebraska Department of Revenue", website: "https://revenue.nebraska.gov/", system: "sales_use", sst: true, note: "Contractor options for materials. Review contract treatment." },
  { state: "NV", stateName: "Nevada", authority: "Nevada Department of Taxation", website: "https://tax.nv.gov/", system: "sales_use", sst: true },
  { state: "NH", stateName: "New Hampshire", authority: "New Hampshire Department of Revenue Administration", website: "https://www.revenue.nh.gov/", system: "none", sst: false, note: "No general sales tax." },
  { state: "NJ", stateName: "New Jersey", authority: "New Jersey Division of Taxation", website: "https://www.nj.gov/treasury/taxation/", system: "sales_use", sst: true },
  { state: "NM", stateName: "New Mexico", authority: "New Mexico Taxation and Revenue Department", website: "https://www.tax.newmexico.gov/", system: "gross_receipts", sst: false, note: "Gross receipts tax generally applies to construction services." },
  { state: "NY", stateName: "New York", authority: "New York State Department of Taxation and Finance", website: "https://www.tax.ny.gov/", system: "sales_use", sst: false, note: "Capital improvements and repairs are treated differently. Review contract treatment." },
  { state: "NC", stateName: "North Carolina", authority: "North Carolina Department of Revenue", website: "https://www.ncdor.gov/", system: "sales_use", sst: true, note: "Real property contracts and repair/maintenance are treated differently." },
  { state: "ND", stateName: "North Dakota", authority: "North Dakota Office of State Tax Commissioner", website: "https://www.tax.nd.gov/", system: "sales_use", sst: true },
  { state: "OH", stateName: "Ohio", authority: "Ohio Department of Taxation", website: "https://tax.ohio.gov/", system: "sales_use", sst: true },
  { state: "OK", stateName: "Oklahoma", authority: "Oklahoma Tax Commission", website: "https://oklahoma.gov/tax.html", system: "sales_use", sst: true },
  { state: "OR", stateName: "Oregon", authority: "Oregon Department of Revenue", website: "https://www.oregon.gov/dor/", system: "none", sst: false, note: "No general sales tax." },
  { state: "PA", stateName: "Pennsylvania", authority: "Pennsylvania Department of Revenue", website: "https://www.revenue.pa.gov/", system: "sales_use", sst: false },
  { state: "RI", stateName: "Rhode Island", authority: "Rhode Island Division of Taxation", website: "https://tax.ri.gov/", system: "sales_use", sst: true },
  { state: "SC", stateName: "South Carolina", authority: "South Carolina Department of Revenue", website: "https://dor.sc.gov/", system: "sales_use", sst: false },
  { state: "SD", stateName: "South Dakota", authority: "South Dakota Department of Revenue", website: "https://dor.sd.gov/", system: "sales_use", sst: true, note: "Contractor's excise tax applies to some construction. Review contract treatment." },
  { state: "TN", stateName: "Tennessee", authority: "Tennessee Department of Revenue", website: "https://www.tn.gov/revenue.html", system: "sales_use", sst: true },
  { state: "TX", stateName: "Texas", authority: "Texas Comptroller of Public Accounts", website: "https://comptroller.texas.gov/", system: "sales_use", sst: false, note: "New construction and residential repair are treated differently from nonresidential repair. Review contract treatment." },
  { state: "UT", stateName: "Utah", authority: "Utah State Tax Commission", website: "https://tax.utah.gov/", system: "sales_use", sst: true },
  { state: "VT", stateName: "Vermont", authority: "Vermont Department of Taxes", website: "https://tax.vermont.gov/", system: "sales_use", sst: true },
  { state: "VA", stateName: "Virginia", authority: "Virginia Department of Taxation", website: "https://www.tax.virginia.gov/", system: "sales_use", sst: false },
  { state: "WA", stateName: "Washington", authority: "Washington State Department of Revenue", website: "https://dor.wa.gov/", system: "sales_use", sst: true, note: "Retail sales tax generally applies to construction services, with destination-based local rates." },
  { state: "WV", stateName: "West Virginia", authority: "West Virginia State Tax Department", website: "https://tax.wv.gov/", system: "sales_use", sst: true },
  { state: "WI", stateName: "Wisconsin", authority: "Wisconsin Department of Revenue", website: "https://www.revenue.wi.gov/", system: "sales_use", sst: true },
  { state: "WY", stateName: "Wyoming", authority: "Wyoming Department of Revenue", website: "https://revenue.wyo.gov/", system: "sales_use", sst: true },
];

export const STATE_CODES = TAX_AUTHORITIES.map((a) => a.state);
export const authorityFor = (state: string | null | undefined) => TAX_AUTHORITIES.find((a) => a.state === (state ?? "").toUpperCase()) ?? null;
export const hasGeneralSalesTax = (state: string) => {
  const a = authorityFor(state);
  return a ? a.system === "sales_use" || a.system === "transaction_privilege" || a.system === "gross_receipts" : false;
};
