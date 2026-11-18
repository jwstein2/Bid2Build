/**
 * Statewide base rates bundled with Built2Bid (V6.9 built-in tax engine), checked against the states' published
 * rates on SEED_CHECKED_ON. They are a starting point only:
 *   - The hourly import of each state's official rate file replaces them (official rates always win over seed rates,
 *     see public.tax_rate_on and builtin.ts), and from then on rate changes arrive without a deploy.
 *   - In states with local sales taxes, a seed rate alone is never presented as the full rate: the calculation is
 *     flagged "local rate not loaded yet" until the official local rates are in.
 *   - States whose rate was changing around the check date (DC, UT) have no seed and wait for the official import.
 * The migration seeds public.tax_jurisdiction_rates from this list (source 'seed'); a test keeps the two in sync.
 */
export const SEED_CHECKED_ON = "2026-11-18";
export const SEED_EFFECTIVE_FROM = "2026-11-01";

export interface SeedRate { state: string; code: string; name: string; level: "state" | "other"; rate: string }

const S = (state: string, rate: string, name: string): SeedRate => ({ state, code: state, name, level: "state", rate });

export const SEED_RATES: readonly SeedRate[] = [
  S("AL", "4", "Alabama"), S("AZ", "5.6", "Arizona"), S("AR", "6.5", "Arkansas"), S("CA", "7.25", "California"), S("CO", "2.9", "Colorado"),
  S("CT", "6.35", "Connecticut"), S("FL", "6", "Florida"), S("GA", "4", "Georgia"), S("HI", "4", "Hawaii"), S("ID", "6", "Idaho"),
  S("IL", "6.25", "Illinois"), S("IN", "7", "Indiana"), S("IA", "6", "Iowa"), S("KS", "6.5", "Kansas"), S("KY", "6", "Kentucky"),
  S("LA", "5", "Louisiana"), S("ME", "5.5", "Maine"), S("MD", "6", "Maryland"), S("MA", "6.25", "Massachusetts"), S("MI", "6", "Michigan"),
  S("MN", "6.875", "Minnesota"), S("MS", "7", "Mississippi"), S("MO", "4.225", "Missouri"), S("NE", "5.5", "Nebraska"), S("NV", "6.85", "Nevada"),
  S("NJ", "6.625", "New Jersey"), S("NM", "4.875", "New Mexico"), S("NY", "4", "New York"), S("NC", "4.75", "North Carolina"), S("ND", "5", "North Dakota"),
  S("OH", "5.75", "Ohio"), S("OK", "4.5", "Oklahoma"), S("PA", "6", "Pennsylvania"), S("RI", "7", "Rhode Island"), S("SC", "6", "South Carolina"),
  S("SD", "4.2", "South Dakota"), S("TN", "7", "Tennessee"), S("TX", "6.25", "Texas"), S("VT", "6", "Vermont"), S("VA", "4.3", "Virginia"),
  S("WA", "6.5", "Washington"), S("WV", "6", "West Virginia"), S("WI", "5", "Wisconsin"), S("WY", "4", "Wyoming"),
  // Virginia's 1% local option tax is levied in every city and county, so it is part of every Virginia address's rate.
  { state: "VA", code: "VA-LO", name: "Virginia local option (all localities)", level: "other", rate: "1" },
];

/**
 * States with no local general sales taxes: the state rate is the whole rate for every address, so no address
 * lookup is needed and no "local rate" flag is raised. (NJ's reduced Urban Enterprise Zone rate applies only to
 * qualified sellers and is not modelled.)
 */
export const STATE_ONLY: ReadonlySet<string> = new Set(["CT", "DC", "IN", "KY", "ME", "MD", "MA", "MI", "NJ", "RI"]);
