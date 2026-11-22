# Start Your Contracting Business guide (`/academy/start`)

A free guide that changes with the visitor's **state** (all 50 + DC) and **type of business** (the 41 catalog trades).
It shows what someone needs *before* they can start (licenses, exams, experience, certificates, bonds), then the steps
in order: structure and state registration, EIN and state taxes, state licenses, city/county, insurance and workers'
comp, hiring (classification, unemployment), trucks. Every step links to the official agency.

- **Data:** `scripts/academy/startup/research/<ST>.json` (researched from official pages, Nov 2026) plus `US.json`
  (federal: SBA structure, IRS EIN, IRS worker classification, EPA RRP, EPA Section 608, FMCSA commercial vehicle).
- **Verification:** `python3 -I scripts/academy/startup/check_startup_evidence.py scripts/academy/startup/research [cache]`
  re-fetches every URL (official hosts only), requires each quote word for word, and holds back any number in our own
  words that isn't in a verified quote. Output: `src/lib/academy/startup/data/<ST>.json` + generated `index.ts`
  (bundled with the app; no database, no SQL, no AI calls, no runtime fetches).
- **Display rule:** only verified facts show our plain-language summary. Anything else shows "Being confirmed" with the
  official link. Categories never confirmed are listed under "Still being researched".
- **Trades:** `src/lib/academy/startup/trades.ts` maps each trade to the credential categories it always needs
  ("core") and the ones it needs only for certain work ("ifYou", with the reason shown).
- **Where it shows:** the "Start a business" Academy tab, and a "What <state> requires" panel on every
  "Starting a <trade> business" course and lesson page (state from the saved Academy location or business profile).
- **Refresh:** edit a research file, re-run the checker, commit both. Agencies change pages often; re-run yearly.

## Known soft spots (Nov 2026)
- NH: nh.gov sites block automated fetching, so most NH entries are "being confirmed".
- Some "no state license" / "local only" statuses are inferred from the state's list of what it licenses, or backed by
  a city/county page (TX Austin, CO Boulder County, MO St. Louis); each file's `note` says so.
- GA roofing, IL workers' comp, IN pesticide: not confirmed.

## Research file shape
## File shape (JSON)
{
  "state": "MN",
  "researched_on": "2026-11-22",
  "general": {
    "entity":        { "agency": "...", "summary": "...", "url": "...", "quote": "..." },   // Secretary of State business filing (LLC/corp/assumed name/DBA)
    "state_tax":     { "agency": "...", "summary": "...", "url": "...", "quote": "..." },   // state tax ID registration (sales/use, withholding). Note if construction contractors have special sales-tax rules ONLY if the page says so.
    "unemployment":  { "agency": "...", "summary": "...", "url": "...", "quote": "..." },   // employer UI account when hiring
    "workers_comp":  { "agency": "...", "summary": "...", "url": "...", "quote": "..." },   // who must carry it (e.g. "one or more employees"), sole-proprietor/owner exemptions, construction-specific rules
    "local":         { "summary": "...", "url": "...", "quote": "..." }                      // OPTIONAL: official statement that cities/counties may also license contractors
  },
  "credentials": {
    // One entry per category below. Always include all 9 keys.
    "residential_building": {
      "status": "state_license" | "state_registration" | "threshold" | "no_state_license" | "local_only" | "unknown",
      "name": "Residential Building Contractor license",        // official credential name(s)
      "agency": "MN Dept. of Labor and Industry",
      "covers": "who needs it, in plain words (e.g. contractors doing two or more special skills on residential property)",
      "threshold": "e.g. jobs over $X; or null",
      "prerequisites": ["exam for qualifying person", "N years experience", ...],   // what must be done BEFORE you can get it / start; each item must be supported by a quote in `evidence`
      "bond": "bond requirement in plain words, or null",
      "insurance": "insurance required to get the license, or null",
      "summary": "2-3 plain sentences",
      "url": "...", "quote": "...",
      "evidence": [ { "url": "...", "quote": "..." } ],     // OPTIONAL extra quotes backing threshold/prerequisites/bond
      "note": "anything uncertain"
    },
    "commercial_building": {...},   // general contractor for commercial work (may be same license as residential: say so)
    "electrical": {...},            // electrical contractor + individual electrician (journeyman/master) path
    "plumbing": {...},
    "mechanical": {...},            // HVAC / refrigeration / gas fitting / sheet metal; note if state has none
    "roofing": {...},               // separate roofing license/registration if any; else "no_state_license" and say it falls under residential_building if it does
    "pesticide": {...},             // commercial pesticide applicator certification + pest control business license (pest control; also lawn/weed control, tree spraying)
    "asbestos": {...},              // asbestos abatement contractor/worker license or notification for demolition/renovation
    "lead_rrp": {...},              // lead-safe renovation (RRP): is the state EPA-authorized to run its own RRP program (state certification) or does EPA certify firms directly?
    "other": [                      // OPTIONAL list of other state-licensed specialties a home-services contractor might hit, e.g. home improvement salesperson, well drilling, septic/onsite wastewater, irrigation, fire sprinkler, low voltage, elevator, manufactured home installer, home inspector (skip), arborist/tree (only if state licenses it), boiler, gas fitter, crane operator, blasting
      { "key": "irrigation", "name": "...", "agency": "...", "trades": ["landscaping"], "summary": "...", "url": "...", "quote": "..." }
    ]
  }
}

