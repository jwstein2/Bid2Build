# Bid check questionnaire (/bid-check)

A short, mobile-first questionnaire for contractors who come from Facebook. It opens with "What's slowing down your bids?", asks 6 questions (one per screen, with a back button and honest progress), and shows a tailored result before it asks for an email. An optional 5–7 question bonus path sharpens the result.

- URL: https://built2bid.org/bid-check
- Trade hint: `?trade=decks|painting|roofing|siding|concrete|remodeling|kitchens|bathrooms|electrical|drywall` preselects the trade (it can still be changed).
- Campaign: the standard `utm_source / utm_medium / utm_campaign / utm_content` parameters (or `c=`) are stored on the anonymous session row. No email is ever stored on that row or in analytics.
- Result: a headline, what to tackle first, one thing to try on the next estimate, and a real Built2Bid example (estimate, profit view, proposal, Pipeline board or template) built from sample data. One clear action opens that example in the builder.
- CTA: people who bid 0–4 times a month get "Start a free bid" as the main step. Everyone else gets "Email me my 7-day Unlimited pass". Both are always available.
- The pass uses the same invite, activation and one-per-email rules as the Facebook comment-BID trial. The 7 days start at activation, no card is taken, paid plans and saved bids are left alone, and check-in emails need their own opt-in.

## Switches (Netlify → Site configuration → Environment variables)

| Variable | Value | Effect |
|---|---|---|
| `FB_TRIAL_ENABLED` | `true` | The pass form works. While it's off, the result page says free passes are paused and points to the free bid. |
| `META_BID_CHECK_LINK` | `true` | The private Messenger reply to "BID" comments adds: "Want a quick tip for your next estimate first? Answer 6 questions: <link>". |
| `META_POST_TRADES` | `<page>_<post>:decks,<page>_<post>:painting,<page>_<post>:remodeling` | Gives each Page post's Messenger link its trade hint and the campaign `fb_bid_<trade>`. |

All three are non-secret. The questionnaire works without any of them: free bid and examples only.

## Funnel

Admin → Marketing → Facebook trial → "Bid check questionnaire" panel shows started, completed, result shown, pass requested, pass activated, first bid finalized and paid upgrade. It also breaks numbers down by goal, trade and campaign, and lists recent free-text feedback (contact details are scrubbed).

## Facebook captions (keep campaigns paused until James approves posting)

Each trade has two versions:

- **Group version.** A direct link, written as a personal post asking for feedback. Check each group's rules on links first.
- **Page version.** For the Built2Bid Page, using the Comment BID → Messenger flow. Add the post id to `META_POST_TRADES` so the Messenger link carries the trade.

### Deck builders

**Group (direct link)**

> Deck guys: what slows your bids down more, stairs and railings, or just getting the numbers out of your notes and into something you can send?
>
> I built a 6-question check that gives you one specific thing to try on your next deck estimate and shows an example bid set up that way. No email needed to see the result. I'd love blunt feedback on whether the tip is actually useful.
>
> https://built2bid.org/bid-check?trade=decks&utm_source=facebook&utm_medium=group&utm_campaign=bid_check_decks&utm_content=group_v1

**Page (Comment BID)**

> Stairs, railings, demo on a tear-off… which part of a deck bid eats your evening?
>
> Comment **BID** and we'll message you a 6-question bid check for deck builders. You get one fix to try on your next estimate and an example deck bid built that way. Regular bidders can also grab a free 7-day Unlimited pass (no card).

### Painters

**Group (direct link)**

> Painters: is it the measuring, the prep and repairs, or writing it up that makes estimates take forever?
>
> I put together a 6-question check that points at the one thing to fix first and shows a sample paint estimate with that part broken out (prep, repairs, coats). Results show up right away, no email. Tell me if it misses the mark for how you bid.
>
> https://built2bid.org/bid-check?trade=painting&utm_source=facebook&utm_medium=group&utm_campaign=bid_check_painters&utm_content=group_v1

**Page (Comment BID)**

> Prep, patching, caulking, trim… the stuff that never makes it onto the estimate until it's too late.
>
> Comment **BID** and we'll message you a quick bid check for painters: 6 taps, one tip for your next estimate, and an example paint bid that prices prep the right way. Busy painters can also get a free 7-day Unlimited pass, no card.

### Remodelers

**Group (direct link)**

> Remodelers: how many change orders start with "I thought the allowance covered that"?
>
> I made a 6-question check for kitchen, bath and renovation bids. It tells you what I'd tackle first (allowances, sub quotes, demo, scope) and shows an example proposal with that section laid out clearly. No email needed to see it, and I want honest feedback.
>
> https://built2bid.org/bid-check?trade=remodeling&utm_source=facebook&utm_medium=group&utm_campaign=bid_check_remodelers&utm_content=group_v1

**Page (Comment BID)**

> Allowances, sub quotes, scope that customers actually read: which one costs you the most time on a remodel bid?
>
> Comment **BID** and we'll message you a 6-question bid check for remodelers. You get one change for your next proposal and an example kitchen or bath proposal built that way. Plus a free 7-day Unlimited pass if you bid often (no card).

## Testing

- `npx vitest run tests/bid-check.test.ts tests/db/bid-check.test.ts`
- Browser walk (10 paths, phone and desktop, all three themes, invite, duplicate, activation): see the header of `scripts/bid-check/walk.mjs`.
