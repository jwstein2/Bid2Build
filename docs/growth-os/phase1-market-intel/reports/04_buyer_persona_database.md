# Buyer Persona Database (v1.0.0)

Generated from `data/personas.json`.

> Personas are composites for planning. They are not interviews with real people. Every 'evidence' item cites an id in data/evidence.csv or data/derived/*. Everything under 'inference' is analyst judgment and should be validated with customer interviews in a later phase (gap G08).
> Team size is always stated as TOTAL PEOPLE INCLUDING THE OWNER. Census employee counts exclude unincorporated owners (E006).
> Product tiers are Built2Bid's real plans from the app repository (S13): Free (credits), Individual Unlimited ($19.99/month or $199/year) [E180] [E181], and Team ($49.99/month including 3 users, then graduated seats) [E182] [E183]. Add-ons: Project Command Center $4.99/month [E184] and Solo Financials $21.99/month [E185].
> Marketing messages follow Built2Bid's own ad rules (docs/growth/ADS.md): no testimonials, no speed, profit, 'win more jobs' or percentage claims [E191]. They describe what the product does, not outcomes. Nothing has been launched.

## Built2Bid plans (real list prices from the app repository)

- **Free**: Credit-based: 3 starter credits plus 1 monthly credit from month two; one credit per new finalized bid [E189]
- **Individual Unlimited**: $19.99/month or $199/year, one user [E180] [E181]
- **Team**: $49.99/month including 3 users; users 4-5 at $19.99 each, 6-10 at $17.99 each, 11+ at $15.99 each [E182] [E183] [E186]
- **Add-ons**: Project Command Center $4.99/month (Standard) [E184]; Solo Financials $21.99/month [E185]

## P01 Solo Remodeler / Handyman-to-Remodeler

- Segments: REMODEL, FINISH_CARP, OTHER_SPEC
- Audience reference: 311,728 business units (REMODEL solo_viable_base; ESTIMATE (A01 base floor, A03 allocation); data/derived/segment_sizing.csv) [T:persona.P01]
- Product tier: **Free to start, then Individual Unlimited**
- Confidence: medium (sizing high/low-medium; behavior mostly inference)

**Company characteristics**

- total people incl owner: 1 (owner only; may use 1099 helpers) [INF]
- census frame: Nonemployer (NES 2024, NAICS 2361 allocated to 236118)
- revenue band: $25K-$250K receipts (NES size classes 121-123) (persona design band) [INF]
- legal form: Mostly sole proprietor (89.7% of NAICS 23 nonemployers, [D008])
- evidence ids: E010, E012, E016, D008

**Primary business problems**

- Evidence: [E103] quoting is a top time drain for 37% of home service owners
- Evidence: [E104] admin/paperwork 31%
- Evidence: [E087] nearly 35% of residential software shoppers still use manual/paper methods
- Inference: Estimates written at night after site work [INF]
- Inference: Underpricing and scope creep because estimates are not itemized [INF]
- Inference: Slow follow-up loses jobs [INF]

**Likely software objections**

- Evidence: [E082] remodelers have the lowest software budget (~$63/user/month)
- Evidence: [E078] affordability is a switching driver for 7%
- Inference: 'I can do it in a spreadsheet or on paper' [INF]
- Inference: 'I don't have time to set it up' [INF]
- Inference: Distrust of monthly subscriptions [INF]

**Purchase motivations**

- Evidence: [E077] efficiency is the top switching driver (48%)
- Evidence: [E112] only 16% offer tiered good/better/best pricing (upsell headroom)
- Inference: Look more professional than competitors [INF]
- Inference: Win more of the jobs already quoted [INF]

**Channels**

- Evidence: [E141] Facebook 70% of adults
- Evidence: [E150] YouTube 85% of men
- Evidence: [E157] YouTube 77% of adults with HS or less
- Inference: Facebook trade groups [INF]
- Inference: YouTube how-to [INF]
- Inference: Supply-house counter [INF]

**Best Built2Bid use cases (inference)**

- Trade templates for remodeling, handyman and finish carpentry (src/lib/trades/data.ts) [INF]
- Markup or margin pricing with a branded PDF proposal (README) [INF]
- Saved Items & Pricing to reuse line items (Unlimited feature) [INF]
- Change orders (free feature) and e-signature (src/lib/esign) [INF]

**Expected buyer journey (inference)**

- Trigger: lost a job to a faster or more professional quote [INF]
- Searches YouTube or Facebook groups for estimate templates [INF]
- Tries a free trial on phone [INF]
- Converts if first real estimate is sent in one sitting [INF]
- Decision maker = owner alone; purchase in days, not months [INF]

**Preferred marketing messages (hypotheses to test; follow Built2Bid ad rules; nothing has been launched)**

- Build an itemized estimate from a remodeling template and send a branded proposal [INF]
- Show the customer good, better and best options in one proposal [INF]
- Price a change order and get it signed [INF]

## P02 Small Remodeling Firm Owner

- Segments: REMODEL, GC_RES
- Audience reference: 132,114 business units (REMODEL employer_estab_lt20; Census-derived (A02 proxy); data/derived/segment_sizing.csv) [T:persona.P02]
- Product tier: **Team (3 users included); Individual Unlimited if only the owner estimates**
- Confidence: medium

**Company characteristics**

- total people incl owner: 3-12 (owner + office manager/estimator + 1-2 crews; subs for trades) [INF]
- census frame: CBP 2023 employer establishments, 236118, <20 paid employees (97.6% of remodeler establishments) [T:REMODEL.pct_employer_lt20]
- revenue band: NAHB member remodelers: median $2.1M; 23% under $500K (members skew larger than typical) [E052] [E053]
- jobs per year: NAHB primary remodelers: median 12 jobs of $10K+ (mean 31) [E056]
- evidence ids: E051, E052, E053, E056, segment_sizing.csv:REMODEL

**Primary business problems**

- Evidence: [E086] 89% of residential shoppers prioritize estimating
- Evidence: [E074] 75% want estimating and PM in one platform
- Evidence: [E088] 26% of residential builders request customer management
- Evidence: [E062] RMI leads/inquiries index 53 in Q3 2026 (positive, but the weakest RMI component)
- Inference: Owner is the bottleneck for every estimate [INF]
- Inference: Change orders not priced or signed [INF]
- Inference: Estimates don't flow into job budgets [INF]

**Likely software objections**

- Evidence: [E082] low per-user budget (~$63)
- Inference: 'We already pay for a big suite we barely use' [INF]
- Inference: Migration of price book/templates [INF]
- Inference: Crew won't adopt it [INF]

**Purchase motivations**

- Evidence: [E077] efficiency 48%
- Evidence: [E073] project management requested by 68%
- Inference: Get the owner out of nightly estimating [INF]
- Inference: Protect margin on change orders [INF]

**Channels**

- Evidence: [E146] Facebook 78% of adults 30-49
- Evidence: [E151] Instagram 64% of 30-49
- Evidence: [E144] LinkedIn 31% of adults
- Inference: Remodeler associations [INF]
- Inference: Peer groups [INF]
- Inference: Search [INF]

**Best Built2Bid use cases (inference)**

- Shared Saved Items & Pricing across estimators (Unlimited/Team) [INF]
- Subcontractor quotes rolled into the estimate (free feature) [INF]
- Change orders with e-signature [INF]
- Internal Estimate Report for margin review (Unlimited) [INF]
- Project Command Center add-on for scheduling after the sale [INF]

**Expected buyer journey (inference)**

- Trigger: hiring an estimator or a margin miss on a big job [INF]
- Compares 2-3 tools (review sites, peer groups, NAHB/NARI chapters) [INF]
- Demo + trial with real past job [INF]
- Owner decides, office manager influences [INF]
- Weeks to decide [INF]

**Preferred marketing messages (hypotheses to test; follow Built2Bid ad rules; nothing has been launched)**

- Everyone on your team estimates from the same saved prices [INF]
- Roll sub quotes and change orders into one proposal [INF]
- See your margin on the internal report before the customer sees the price [INF]

## P03 Growth-Stage Roofing Contractor

- Segments: ROOF, SIDING
- Audience reference: 23,053 business units (ROOF employer_estab_lt20; Census-derived (A02 proxy); data/derived/segment_sizing.csv) [T:persona.P03]
- Product tier: **Team (sales reps as licensed users); Individual Unlimited for owner-only roofers**
- Confidence: medium-low (RCS sample small and partly gated)

**Company characteristics**

- total people incl owner: 5-20 (owner, sales/estimator, office, crews often subcontracted) [INF]
- census frame: CBP 2023, 238160, <20 paid employees (90.3% of roofing establishments) [T:ROOF.pct_employer_lt20]
- revenue band: Jobber roofing respondents: over half earn $500K+ [E115]
- labor model: 57% of roofing contractors in RCS survey use subcontracted crews [E132]
- evidence ids: E115, E132, E130, segment_sizing.csv:ROOF

**Primary business problems**

- Evidence: [E134] top issues: recruitment & retention, training, material cost
- Evidence: [E133] nearly 50% say digital advertising is their greatest marketing need
- Evidence: [E127] 28% of Jobber roofing respondents saw significant demand increases
- Inference: Material price swings make old quotes unprofitable [INF]
- Inference: High quote volume after storms [INF]
- Inference: Insurance-scope reconciliation [INF]

**Likely software objections**

- Inference: 'We already use a roofing CRM and a measurement service' [INF]
- Inference: Needs integration with aerial measurements and supplier pricing [INF]
- Inference: Sales reps resist new tools [INF]

**Purchase motivations**

- Evidence: [E114] 67% already use AI (tech-forward)
- Evidence: [E128] 32% of Jobber roofing respondents expect significant revenue growth
- Inference: Close more same-visit [INF]
- Inference: Scale sales without owner on every appointment [INF]

**Channels**

- Evidence: [E129] Jobber roofing spotlight: YouTube, Local Services Ads and Google are high-performing channels
- Evidence: [E150] YouTube 85% of men
- Inference: Roofing trade media and podcasts [INF]
- Inference: Supplier events [INF]

**Best Built2Bid use cases (inference)**

- Roofing template with trade measurements (src/lib/market/trade-models.ts) [INF]
- Good/better/best shingle options in one proposal [INF]
- Sales pipeline to track open bids (free feature) [INF]
- Company proposal style so every rep's proposal looks the same [INF]

**Expected buyer journey (inference)**

- Trigger: adding a sales rep or a storm season [INF]
- Researches via YouTube, roofing communities (RCS), peers [INF]
- Demo focused on speed and integrations [INF]
- Owner decides; sales manager influences [INF]
- Trial during slower season [INF]

**Preferred marketing messages (hypotheses to test; follow Built2Bid ad rules; nothing has been launched)**

- Measure, price and present from one roofing template [INF]
- Every rep sends the same branded proposal [INF]
- Track every open roofing bid in one pipeline [INF]

## P04 Owner-Operator Trade Service Contractor (Electrical / Plumbing / HVAC)

- Segments: ELEC, PLUMB, HVAC
- Audience reference: 348,114 business units (ELEC + PLUMB(HVAC shared) units_1to20_base; Derived from Census; solo portion direct NES; data/derived/segment_sizing.csv (150,388 + 197,726)) [T:persona.P04]
- Product tier: **Individual Unlimited; Team for shops with 3+ estimators**
- Confidence: low-medium (crowded category; product fit unvalidated)

**Company characteristics**

- total people incl owner: 1-8 (licensed owner, 1-5 techs/apprentices, part-time office) [INF]
- census frame: CBP 238210/238220 <20 paid employees (88.1% / 88.7%); NES 23821/23822 direct [T:ELEC.pct_employer_lt20] [T:PLUMB.pct_employer_lt20]
- revenue band: Jobber HVAC respondents: over 60% earn $500K+ [E117]
- evidence ids: E116, E117, E118, E119, segment_sizing.csv:ELEC,PLUMB

**Primary business problems**

- Evidence: [E085] specialty contractor budget ~$150-157/user
- Evidence: [E111] only 20% of home service businesses respond to leads within an hour
- Inference: Mix of quick service tickets and larger project bids (panel upgrades, repipes, system replacements) [INF]
- Inference: Project bids done on paper outside the field-service tool [INF]

**Likely software objections**

- Inference: 'My field-service app already does quotes' [INF]
- Inference: Price book maintenance burden [INF]
- Inference: Another login for techs [INF]

**Purchase motivations**

- Evidence: [E116] HVAC 81.5% AI use; [E119] electrical 64%
- Evidence: [E113] 65% raised prices last year
- Inference: Win larger project jobs, not just service calls [INF]
- Inference: Present options professionally [INF]

**Channels**

- Evidence: [E106] referrals 59%
- Evidence: [E108] Google Search 20%
- Inference: Supply houses [INF]
- Inference: Trade associations [INF]
- Inference: YouTube [INF]

**Best Built2Bid use cases (inference)**

- Electrical, plumbing and HVAC templates for project and replacement bids [INF]
- Option pricing for upgrades [INF]
- QuickBooks connection (src/lib/quickbooks) [INF]
- Use alongside an existing field-service app for project work (fit unvalidated) [INF]

**Expected buyer journey (inference)**

- Trigger: losing project bids or moving into replacements [INF]
- Evaluates whether current FSM tool is enough [INF]
- Trial only if it complements, not replaces, FSM [INF]
- Owner decides quickly [INF]

**Preferred marketing messages (hypotheses to test; follow Built2Bid ad rules; nothing has been launched)**

- Quote the project jobs, not just the service calls, from trade templates [INF]
- Put equipment options side by side in one proposal [INF]
- Send a branded proposal with e-signature [INF]

## P05 Exterior Specialty Crew Owner (Siding / Decks / Concrete / Fencing)

- Segments: SIDING, DECKS, CONCRETE, OTHER_SPEC, MASONRY
- Audience reference: 329,774 business units (SIDING+CONCRETE+OTHER_SPEC+MASONRY units_1to20_base; Derived; solo portion ESTIMATED (A03); data/derived/segment_sizing.csv (25,905 + 54,808 + 201,010 + 48,051); decks not countable) [T:persona.P05]
- Product tier: **Individual Unlimited; Team with 3+ users**
- Confidence: low-medium

**Company characteristics**

- total people incl owner: 2-8 (owner selling and working, 1-2 crews) [INF]
- census frame: CBP 238170/238110/238990/238140 <20 paid employees; NES 2381/2389 allocated
- revenue band: Not measured by any verified source (gap)
- evidence ids: segment_sizing.csv:SIDING,CONCRETE,OTHER_SPEC,MASONRY

**Primary business problems**

- Evidence: [E103] quoting 37% top time drain
- Evidence: [E112] 16% offer tiered options
- Inference: Material take-offs by hand [INF]
- Inference: Seasonal rush of estimate requests [INF]
- Inference: Design options (composite vs. wood, stamped vs. broom finish) hard to price consistently [INF]

**Likely software objections**

- Inference: 'Every job is different' [INF]
- Inference: Cost [INF]
- Inference: Learning curve in peak season [INF]

**Purchase motivations**

- Evidence: [E077] efficiency is the top switching driver (48%)
- Inference: Respond faster than competitors in peak season [INF]
- Inference: Higher close rate on options [INF]

**Channels**

- Evidence: [E141] Facebook 70%
- Evidence: [E151] Instagram 64% of 30-49
- Evidence: [E149] Facebook 76% of rural adults
- Inference: Facebook trade groups [INF]
- Inference: Instagram project photos [INF]
- Inference: Lumber/supply yards [INF]

**Best Built2Bid use cases (inference)**

- Deck, siding, concrete, fencing and masonry templates with per-foot units [INF]
- Trade calculators (src/lib/calculators) [INF]
- Option sets (composite vs. wood, stamped vs. broom finish) [INF]
- Sales pipeline for the spring backlog [INF]

**Expected buyer journey (inference)**

- Trigger: estimate backlog in spring [INF]
- Facebook group / YouTube discovery [INF]
- Self-serve trial [INF]
- Owner decides within a week [INF]

**Preferred marketing messages (hypotheses to test; follow Built2Bid ad rules; nothing has been launched)**

- Turn a site measure into an itemized proposal from a deck, siding or concrete template [INF]
- Lay out material options side by side for the customer [INF]
- Keep every open estimate in one pipeline [INF]

## P06 Painting / Finishing Contractor

- Segments: PAINT, DRYWALL, FLOORING, TILE
- Audience reference: 329,967 business units (PAINT+DRYWALL+FLOORING+TILE units_1to20_base; Derived; solo portion ESTIMATED (A03); data/derived/segment_sizing.csv (150,044 + 67,829 + 71,770 + 40,324)) [T:persona.P06]
- Product tier: **Free to start, then Individual Unlimited**
- Confidence: low-medium

**Company characteristics**

- total people incl owner: 1-10 (owner-painter plus helpers; many solo) [INF]
- census frame: NES 2383 (building finishing) is the largest construction nonemployer group in this frame, 678,091 [E021]; CBP 238320 has 95.4% of establishments under 20 paid employees [T:PAINT.pct_employer_lt20]
- revenue band: Not measured by a verified trade source (gap)
- evidence ids: E021, segment_sizing.csv:PAINT

**Primary business problems**

- Evidence: [E103] quoting 37%
- Inference: High quote volume with low win rate [INF]
- Inference: Price shopping by homeowners [INF]
- Inference: Measuring rooms/surfaces [INF]

**Likely software objections**

- Inference: Very price-sensitive [INF]
- Inference: 'I quote by eye' [INF]

**Purchase motivations**

- Evidence: [E110] 36% win >70% of quotes (top performers)
- Inference: Quote more jobs per week [INF]
- Inference: Consistent pricing across estimators [INF]

**Channels**

- Evidence: [E153] Nextdoor 23% of suburban adults
- Evidence: [E141] Facebook 70%
- Inference: Facebook groups [INF]
- Inference: Paint-store counters [INF]

**Best Built2Bid use cases (inference)**

- Painting, drywall, flooring and tile templates [INF]
- Saved Items & Pricing for production-rate line items [INF]
- Choose what the customer sees per section (README) [INF]
- E-signature [INF]

**Expected buyer journey (inference)**

- Facebook/YouTube discovery [INF]
- Free plan or trial [INF]
- Upgrade when adding an estimator or crew [INF]

**Preferred marketing messages (hypotheses to test; follow Built2Bid ad rules; nothing has been launched)**

- Price every room from your own saved rates [INF]
- Choose exactly which details the customer sees [INF]
- Send a branded proposal they can sign [INF]

## P07 Exterior Cleaning Operator (Pressure / Soft Washing)

- Segments: PRESSURE_WASH, SOFT_WASH
- Audience reference: 70,696 business units (PRESSURE_WASH units_1to20_base; Census-derived; overstated; data/derived/segment_sizing.csv (NAICS 561790, includes other building services; overstates washing)) [T:persona.P07]
- Product tier: **Free credits; Individual Unlimited for higher volume**
- Confidence: low (category fit weakest; outside NAICS 23)

**Company characteristics**

- total people incl owner: 1-4 [INF]
- census frame: NAICS 561790 (outside construction); NES 56179 direct
- revenue band: Proxy: over 40% of Jobber cleaning respondents earn under $50K [E122]; 63.6% of NES 56179 nonemployers have receipts under $25K [E022]
- evidence ids: E122, E123, E022

**Primary business problems**

- Evidence: [E111] only 20% of home service owners respond to leads within an hour
- Evidence: [E170] cleaning businesses are the fastest responders at 26% within an hour
- Inference: Many small quotes by text [INF]
- Inference: Seasonality [INF]
- Inference: Upselling roof/gutter add-ons [INF]

**Likely software objections**

- Evidence: [E123] cleaning AI adoption 50%, lower than trades
- Inference: Already use a general field-service app [INF]
- Inference: Low ticket size limits spend [INF]

**Purchase motivations**

- Inference: Speed to quote [INF]
- Inference: Upsell add-ons [INF]

**Channels**

- Evidence: [E107] Facebook a lead source for 32%
- Inference: Facebook trade groups [INF]

**Best Built2Bid use cases (inference)**

- Pressure-washing and soft-washing templates (src/lib/trades/data.ts) [INF]
- Add-on line items (roof soft wash, gutters, concrete) [INF]
- Branded proposal and e-signature [INF]

**Expected buyer journey (inference)**

- Facebook groups and YouTube [INF]
- Self-serve, price-driven [INF]
- Churn risk high [INF]

**Preferred marketing messages (hypotheses to test; follow Built2Bid ad rules; nothing has been launched)**

- Pressure- and soft-washing templates ready to price [INF]
- Offer add-ons as separate line items the customer can see [INF]
- Send a branded quote they can sign [INF]
