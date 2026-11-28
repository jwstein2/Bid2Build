# UTM convention

Checked by `src/lib/growth/utm-convention.ts` (`utmIssues`, `conventionUrl`) and reported on **Admin → Marketing → Customer journey → Data quality**.

| Tag | Rule | Examples |
|---|---|---|
| `utm_source` | Where the link sits: the platform or tool | `google`, `facebook`, `instagram`, `youtube`, `instantly`, `newsletter` |
| `utm_medium` | One of: `cpc`, `paid_search`, `paid_social`, `display`, `video`, `social`, `email`, `sms`, `creator`, `partner`, `affiliate`, `referral`, `qr`, `print`, `event` | `cpc`, `paid_social`, `email` |
| `utm_campaign` | Paid (`cpc`, `paid_search`, `paid_social`, `display`): `b2b-<platform>-<goal>-<yyyymm>`. Otherwise a short snake or kebab name, or the creator's handle. | `b2b-meta-signup-202612`, `cold_outreach`, `deckguy` |
| `utm_content` | Creative or post id | `b-h1-15s-916-v1`, `nov17_am` |
| `utm_term` | Paid search keyword (optional) | `roofing_estimate_software` |

Rules:
- Lower case only. Use only letters, digits, `_`, `-` and `.`.
- Always use source, medium and campaign together.
- Sales rep (`/s/<code>`), affiliate (`/a/<code>`) and referral (`?ref=`) links are tagged by the app. Don't add your own tags to them.
- The existing copy-paste links in `docs/marketing/UTM_LINKS.md` and the ad naming in `docs/growth/ADS.md` already follow this (tested).
