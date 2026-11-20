# Ads: creative briefs, naming, $600 test plan and approval gate

Status: **planning only.** All paid campaigns stay paused. Nothing in this document creates, enables or
funds a campaign, buys a tool, or spends Runway/Vizard credits. Every item below needs the owner's explicit
approval before it happens.

Brand identity: **realistic contractor humor + genuine software functionality.** Not a corporate SaaS ad.

Rules for every creative:
- Product shots are real screen recordings of Built2Bid (production or a preview build with example data). No mock-ups, no invented screens.
- No testimonials, ratings or results that haven't happened. No speed, profit, "win more jobs" or percentage claims.
- AI-generated actors, voices or scenes are labeled ("AI-generated" in the caption/description and the platform's AI disclosure toggle).
- Existing Runway and Vizard footage is reused first. New generations need approval (credits cost money).
- Customer data never appears: an obviously fictional example company, example customer, example prices.
- Every creative stays a draft until the owner signs it off with the QC checklist below.

## Concepts

Each concept lists the beats, hook variations, what must be screen-recorded, and where it lands. Hooks are
the first two seconds; captions must carry the joke with the sound off.

### A. "Can You Quote One More Thing?"
- Beats: homeowner at the kitchen table, friendly: "Could you do budget, mid and premium?" … "and tile, carpet *and* LVP?" … "and the addition we're not building yet?" Contractor: "Sure." Smash cut to him at 11:48 PM, laptop glow, deadpan stare. Cut to Built2Bid: duplicate a section, swap flooring lines, preview the proposal.
- Hooks: (1) "Can you just quote one more thing?" (2) Close-up of the contractor's face as the third request lands. (3) On-screen text "Option C of Option B of…".
- Screen recordings: Duplicate Selected on a section (an Unlimited feature, so say so or record on a Free-plan alternative), editing line items, proposal preview.
- Lands on: `/bids/flooring` or `/bids/kitchens` (match the scene). CTA: the page's own CTA.
- Claims check: shows organizing options and a clean proposal. No "minutes" claim.

### B. "Take Back Your Nights"
- Beats: dark kitchen, contractor with a notepad and calculator. Spouse from the hallway: "You coming to bed?" Contractor, not looking up: "Footings." Spouse: "…It's midnight." Cut to the same estimate in Built2Bid (calculator on the line item, totals updating).
- End card (owner's line): **"Save time. Send professional bids. Built2Bid.org"**.
- Hooks: (1) "You coming to bed?" (2) Clock 11:58 PM + calculator tape. (3) "Estimating after the kids are asleep?"
- Screen recordings: deck estimate with the board-count calculator, totals, proposal preview.
- Lands on: `/bids/decks` (decks copy literally says "Stop Spending Your Nights Writing Deck Estimates").

### C. "The Napkin Estimate"
- Beats: contractor slides a folded napkin across the counter: "$14,5… that's a 5." Homeowner squints. Rewind, same contractor hands over a phone with a branded Built2Bid proposal (logo, sections, total). Homeowner nods.
- Hooks: (1) The napkin hitting the counter. (2) "Is that a 5 or an S?" (3) "We've all sent this estimate."
- Screen recordings: branded proposal PDF / preview with logo and sections.
- Lands on: `/bids/general-contracting` or the trade shown.

### D. "Markup Is Not Margin"
- Beats: owner, confident, to the camera: "I mark everything up 30%, so I make 30%." Pause. A crew member off-screen: "…you sure?" Owner opens Built2Bid, sets a 30% target margin, and sees the price it needs versus a 30% markup. Quiet "huh."
- Hooks: (1) "I mark up 30%, so I make 30%." (2) On-screen text "30% markup ≠ 30% margin". (3) The crew member's face.
- Screen recordings: markup vs target margin setting in the builder and the resulting totals. Use the real numbers on screen (30% markup = 23.1% margin; 30% margin = 42.9% markup) and nothing beyond them.
- Lands on: `/bids/general-contracting`. Longer YouTube cut (45–60s) can walk through the math.

### E. "Same Bid, Four Ways"
- Beats: one estimate, four customers. Quick cuts of the proposal step switching between the four price displays that exist today (verified in `src/lib/trades/landing.ts` `PRICE_DISPLAYS` and the proposal settings): **Fully itemized**, **Item names, no prices**, **Section totals only**, **Project total only**. Customer reactions: the engineer wants every line, the busy one wants one number.
- Hooks: (1) "Same bid. Four customers." (2) Split screen of the four layouts. (3) "Your costs stay hidden in all four."
- Screen recordings: the proposal step's display options, the preview for each.
- Lands on: any priority trade page (all show the four displays).

## Asset list per creative

For each concept prepare, as drafts: 15s cut, 30s cut, longer cut where it helps (D, E), 9:16 vertical,
4:5 or 1:1 feed version, 2–3 hook variants, 2 caption variants, burned-in captions, thumbnail (YouTube),
the landing page it matches, CTA text, and the tracking URL (below). Keep source files and exports in the
shared drive folder the owner chooses, named with the creative id.

## Video QC checklist (score each 1–5; ship only at 4+ everywhere, and 5 on accuracy)

| Check | Question |
|---|---|
| First two seconds | Would a contractor stop scrolling? Is the hook visible without sound? |
| Pacing | Does it feel natural, with no dead air and no rushed punchline? |
| Humor | Is the joke from real contractor life, not at the customer's expense? |
| Authenticity | Do people, tools and job sites look real? Is AI content labeled? |
| Problem clarity | Is the pain obvious in five seconds? |
| Product accuracy | Is every screen a real Built2Bid recording, with every claim true today? (must be 5) |
| CTA | Is there one clear action, and does it match the landing page? |
| Mobile readability | Is text large enough at 390px wide and inside the platform's safe zones? |
| Sound off | Do captions carry the whole story? |
| Data safety | No real customer names, prices or addresses? |
| Tracking | Does the URL carry the right UTM tags (checked in a private window)? |

## Naming and tracking standard

All tags lower-case, hyphens only. The dashboard reads these exactly (`src/lib/admin/channels.ts`).

| Tag | Meta ads | YouTube ads | Creator Partner links |
|---|---|---|---|
| `utm_source` | `facebook` or `instagram` | `youtube` | the platform (`youtube`, `instagram`, …) |
| `utm_medium` | `paid_social` | `video` | `creator` |
| `utm_campaign` | `b2b-meta-<goal>-<yyyymm>` e.g. `b2b-meta-signup-202612` | `b2b-yt-<goal>-<yyyymm>` | the creator's handle, e.g. `deckguy` |
| `utm_content` | creative id | creative id | optional (video id) |

Creative id: `<concept>-<hook>-<length>-<ratio>-v<n>`, e.g. `b-h1-15s-916-v1` (concept B, hook 1, 15 s, 9:16, version 1).
Use the same id as the ad name in Ads Manager / Google Ads so spend and results line up.

Example: `https://built2bid.org/bids/decks?utm_source=facebook&utm_medium=paid_social&utm_campaign=b2b-meta-signup-202612&utm_content=b-h1-15s-916-v1`

Spend is entered monthly per campaign on `/admin/marketing` (no ad-platform API is connected). The
creative table there shows signups, 7-day activation, finalized, paying and MRR per `utm_content`.

## $600/month test plan (draft, not active)

Allocation: **Meta $400, YouTube $180, reserve $20.** A small number of tests with enough signal beats
many thin ones.

| | Meta | YouTube |
|---|---|---|
| Campaigns | 1 | 1 |
| Ad sets / groups | 1 (broad US or the owner's service states; Advantage+ audience with contractor-related interests as signals, not guarantees) | 1 (in-feed / Shorts placements, contractor-related topics and keywords) |
| Creatives | 3: B (decks), A (flooring/kitchens), E | 2: D (long cut), C |
| Daily budget | about $13/day | about $6/day |
| Optimization | CompleteRegistration (only after the CAPI test event is verified; until then, landing page views) | Views/clicks to the landing page |
| Window | 30 days, no edits for the first 7 days except a broken ad | 30 days |

Targeting can't promise "contractors only": platform interest and topic targeting are approximate. The
landing page and the 7-day activation metric do the filtering.

### KPIs (from `/admin/marketing`, GA4 and the ad platforms)
Spend; landing-page visits; CTR; landing-page conversion (visit to signup); cost per registration; **cost per
7-day activated contractor**; cost per paying customer; subscription revenue; retention; CAC; CAC payback.
Optimize for activated and paying contractors, never for the cheapest signups.

### Economics (assumptions labeled; not forecasts)
- Price $19.99/month or $199/year. Net of card fees (about 2.9% + $0.30) a monthly subscriber brings about **$19.12/month**.
- Assumed gross margin after hosting, email and AI costs: **85%** (assumption; replace with Tech Stack & Costs actuals). That is about **$16.25/month gross profit**.
- Gross-profit payback = CAC ÷ $16.25: CAC $50 → about 3 months, $100 → about 6, $200 → about 12, $325 → about 20.
- Lifetime value at an assumed monthly churn *c*: $16.25 ÷ *c*. At 5% that's about $325, at 10% about $163 (assumptions, not data).
- Today: 0 paying customers, so there is no actual CAC, churn or conversion to report yet.

At $19.99/month, paid acquisition only works if CAC stays well under about $160 (10-month payback). That's
why the plan spends small, measures activation, and only scales with evidence.

### Stop and scale rules
- Pause an ad after $60 spend with no registrations, or CTR under 0.5% after 2,000 impressions.
- Pause an ad set after $150 with no 7-day activated contractor.
- Stop the channel for the month after its full budget with no 7-day activated contractor.
- Consider more budget only when a creative has at least 3 paying customers with CAC payback under 10 months on gross profit **and** at least one renewal. High views or CTR alone never earn budget.
- Review weekly. Any change to budgets needs the owner's OK.

## Owner approval gate (fill in before any launch)

| Item | Value |
|---|---|
| Campaign objective | |
| Target audience and geography | |
| Final creatives (ids, QC scores, AI disclosure) | |
| Landing pages | |
| Tracking status (UTMs tested; CAPI test event seen in Events Manager; GA4 key events) | |
| Monthly and daily spend limits | |
| Measurement window | |
| Pause and stop conditions | as above, or changed: |
| Forecast (labeled estimate) | |
| Approvals needed | owner sign-off on spend, creatives and privacy text |

No campaign is created, enabled or funded until the owner approves this table in writing.

## Creator Partners (reporting hooks)

Give each creator one tagged link: `https://built2bid.org/bids/<trade>?utm_source=<platform>&utm_medium=creator&utm_campaign=<handle>`.
`/admin/marketing` → Creator Partner results shows signups, started bid, 7-day activated, paid (Stripe),
paying now and MRR per creator, with complimentary accounts (creator seats, gifts) counted separately and
never as paid. Gifted seats are issued through the existing Complimentary Access tool (`/admin/complimentary`).
Creators see counts only, never a subscriber's estimates, prices or customers, unless that subscriber
opts in through a sharing feature built for it.
