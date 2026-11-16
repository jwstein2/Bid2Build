# Built2Bid UTM links

Use these links everywhere you post Built2Bid outside the app. They tell Google Analytics and the
owner Command Center (Marketing → channels) where each signup came from. Every link below has been
checked against the app's channel rules (`tests/referrals.test.ts`).

**Rules of thumb**

- Copy a link exactly. Lower case, no spaces. Only change the part after `utm_content=`.
- `utm_content` is your label for the specific post/video/email so you can compare them later
  (e.g. `roofing_tip_nov17`, `demo_video_1`). Letters, numbers, `_` and `-` only.
- A visitor is credited to the **first** tagged link they click (90 days), so tag every link.
- Paid ads are different: if you ever run Facebook/Instagram ads, use `utm_medium=paid_social` so
  they show as Meta Ads, not organic posts.

## 1. Automated outreach emails (a few hundred a week) → "Email Outreach"

| Page | Link |
|---|---|
| Home | `https://built2bid.org/?utm_source=instantly&utm_medium=email&utm_campaign=cold_outreach` |
| Pricing | `https://built2bid.org/pricing?utm_source=instantly&utm_medium=email&utm_campaign=cold_outreach` |
| Trade page (swap `roofing`) | `https://built2bid.org/bids/roofing?utm_source=instantly&utm_medium=email&utm_campaign=cold_outreach` |

**Where to paste:** in your email tool, edit each step of the sequence and replace the plain
built2bid.org link with one of these (the button/link URL, not the visible text). If you run more
than one sequence, change `cold_outreach` to the sequence name (e.g. `roofers_tx`). If your tool
isn't Instantly, still keep `utm_medium=email`; you can change `utm_source` to the tool's name.
Turn off the tool's own "link tracking" rewrite if it strips query strings.

## 2. Facebook posts (2 a day) → "Organic Social"

| Page | Link |
|---|---|
| Home | `https://built2bid.org/?utm_source=facebook&utm_medium=social&utm_campaign=daily_posts&utm_content=POST_LABEL` |
| Pricing | `https://built2bid.org/pricing?utm_source=facebook&utm_medium=social&utm_campaign=daily_posts&utm_content=POST_LABEL` |
| Trade page | `https://built2bid.org/bids/roofing?utm_source=facebook&utm_medium=social&utm_campaign=daily_posts&utm_content=POST_LABEL` |

**Where to paste:** in the post text (or the link field) on your Page, profile, and in groups.
Replace `POST_LABEL` with a short name for the post, e.g. `nov17_am`. For posts in a specific group,
`utm_content=group_roofers_texas` makes groups comparable.

## 3. Group chats (text, WhatsApp, Messenger) → "Organic Social"

| Page | Link |
|---|---|
| Home | `https://built2bid.org/?utm_source=groupchat&utm_medium=social&utm_campaign=group_chats&utm_content=CHAT_NAME` |
| Pricing | `https://built2bid.org/pricing?utm_source=groupchat&utm_medium=social&utm_campaign=group_chats&utm_content=CHAT_NAME` |

**Where to paste:** straight into the message. Replace `CHAT_NAME` with a short label for the
group (e.g. `dfw_subs`). Use `utm_source=whatsapp` or `utm_source=sms` instead of `groupchat` if you
want those split out; they still count as Organic Social as long as `utm_medium=social`.

## 4. YouTube videos → "YouTube"

| Page | Link |
|---|---|
| Home | `https://built2bid.org/?utm_source=youtube&utm_medium=video&utm_campaign=videos&utm_content=VIDEO_NAME` |
| Pricing | `https://built2bid.org/pricing?utm_source=youtube&utm_medium=video&utm_campaign=videos&utm_content=VIDEO_NAME` |
| Trade page | `https://built2bid.org/bids/roofing?utm_source=youtube&utm_medium=video&utm_campaign=videos&utm_content=VIDEO_NAME` |

**Where to paste:** YouTube Studio → Content → pencil on the video → Description (first line), and
in a pinned comment. For Shorts, the description and pinned comment. Replace `VIDEO_NAME` (e.g.
`meet_built2bid`).

## 5. Customer referral links → "Referral"

Members' own links (`https://built2bid.org/r/CODE`, shown on their dashboard under "Refer a
contractor, get a month free") are tagged automatically with `utm_source=referral`. Don't add
anything to them.

## Trade page slugs

roofing, siding, decks, concrete, kitchens, bathrooms, interior-remodeling, exterior-remodeling,
drywall, painting, electrical, plumbing, hvac, flooring, tile, framing, finish-carpentry,
cabinets-countertops, windows-doors, insulation, gutters, fencing, landscaping, pressure-washing,
soft-washing, excavation, foundations, masonry, asphalt-paving, demolition, basements, additions,
garages, pole-barns, commercial-remodeling, general-contracting, handyman.

## Where to see results

- Owner Command Center: https://built2bid.org/admin/marketing (signups and paying customers by channel)
- Google Analytics: Reports → Acquisition → Traffic acquisition, set the dimension to
  "Session source / medium" or "Session campaign".
