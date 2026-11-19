# Weekly lead import (Sales Portal Phase 3a)

A scheduled Claude agent finds verified contractor leads once a week in the owner's target (a state
region such as Southeast Minnesota, or a ZIP + radius) and trade and posts them to Built2Bid. They land **unassigned** in the owner's Sales Hub (Leads tab →
"Weekly lead import"), each with a short Haiku 5.5 sales brief, and the owner assigns them to reps.
Nothing is emailed or called automatically. None of this is visible to Built2Bid customers.

## 1. Owner sets the target (Sales Hub → Leads)

Two ways to aim the run, plus trade and leads per run (default 50). "Pause" stops the run.

- **By state region** (preferred): pick a region such as Southeast Minnesota. Each region is a fixed
  county list. Minnesota uses DEED's six planning regions (Twin Cities Metro, Central, Northeast,
  Northwest, Southeast, Southwest); Iowa uses the nine USDA agricultural statistics districts (Northwest,
  North Central, Northeast, West Central, Central, East Central, Southwest, South Central, Southeast).
  The agent works through the state's free contractor license download for those counties and each run
  resumes where the last stopped, so it never re-checks the same businesses. "Start over from the top"
  resets that.
- **By ZIP + radius**: as before (default 50 miles).

Regions exist only where the state publishes a free contractor list:

| State | Free list | Regions |
|---|---|---|
| Minnesota | [DLI residential contractors CSV](https://secure.doli.state.mn.us/ccld/data/MNDLILicRegCertExport_Residential_Contractors.csv) (no county column; regions match by ZIP) | 6 |
| Iowa | [Active construction contractor registrations](https://idh-be.iowa.gov/api/v1/datasets/1052/rows.csv) (data.iowa.gov 1052, zip with one CSV, has county) | 9 |
| Wisconsin | None free: DSPS sells credential lists (from $2,000 for all types) | ZIP only |
| South Dakota | No statewide contractor license (DOR excise tax registration, no public list) | ZIP only |
| North Dakota | Search only (FirstStop); no bulk download found | ZIP only |

Each region's ZIPs are those whose land is mostly in its counties (US Census 2020 ZCTA-county file).

## 2. Agent reads the target

```
GET https://built2bid.org/api/sales/leads/import
Authorization: Bearer $SALES_LEAD_IMPORT_SECRET
```

Region target:

```json
{ "mode": "region", "state": "MN", "zip": null, "radius_miles": 50, "trade": "roofing", "count": 50, "paused": false,
  "region": { "state": "MN", "slug": "southeast", "name": "Southeast Minnesota",
              "counties": ["Dodge", "Fillmore", "..."], "zips": ["55901", "55902", "..."] },
  "source": { "state": "MN", "name": "Minnesota DLI residential contractor licenses", "url": "https://secure.doli.state.mn.us/...csv",
              "format": "csv", "match_by": "zip", "county_field": null, "zip_field": "Zip", "state_field": "St", "name_field": "Name",
              "phone_field": "Phone_No", "email_field": "Email_Address", "status_field": "Status", "active_status": ["Issued"],
              "start_date_field": "Orig_Date", "trade_field": "License_Subtype", "cursor_field": "Lic_Number", "notes": "..." },
  "resume": { "key": "region:MN:southeast:roofing", "cursor": "CR700120", "checked": 140, "added": 31, "runs": 1, "exhausted": false } }
```

ZIP target (unchanged fields, plus `mode: "zip"`, `region: null`, `source: null` and its own `resume`):

```json
{ "mode": "zip", "zip": "55401", "trade": "roofing", "radius_miles": 50, "count": 50, "paused": false, "region": null, "source": null,
  "resume": { "key": "zip:55401:50:roofing", "cursor": null, "checked": 0, "added": 0, "runs": 0, "exhausted": false } }
```

If `paused` is true, the agent stops. `trade` null means any trade in the list. If `resume.exhausted` is
true, the region's list is finished: the agent stops and reports that the owner should pick another
region (or tick "Start over").

## 3. Agent posts verified leads

```
POST https://built2bid.org/api/sales/leads/import
Authorization: Bearer $SALES_LEAD_IMPORT_SECRET
Content-Type: application/json
```

```json
{
  "batch_id": "2026-W47",
  "leads": [{
    "company_name": "Summit Roofing LLC",
    "contact_name": "Dana Lee",
    "email": "office@summitroof.com",
    "phone": "612-555-0100",
    "website": "https://summitroof.com",
    "city": "Minneapolis", "state": "MN", "zip": "55401",
    "trades": ["roofing"],
    "business_started": "2014-03-02",
    "verification": {
      "owner_name": ["https://secure.doli.state.mn.us/lookup/licensing.aspx?..."],
      "email": ["https://summitroof.com/contact"],
      "phone": ["https://summitroof.com/contact", "https://www.bbb.org/..."],
      "business_started": ["https://mblsportal.sos.mn.gov/Business/SearchDetails?..."]
    },
    "source_url": "https://summitroof.com",
    "notes": "Residential re-roofs and storm repair; 4.8 stars on 120 Google reviews"
  }]
}
```

**Required for every lead** (otherwise counted as "not verified" and not stored): business name, owner
name, business email, 10-digit phone, ZIP, at least one trade, business start date (YYYY, YYYY-MM or
YYYY-MM-DD), and at least one public source URL each for the owner name, email and phone. The server
also checks the email's domain has a mail server (MX record) and turns the lead away if it doesn't.

Optional, for region targets (and ZIP targets that work through a list): where this run stopped, so the
next run resumes after it. `cursor` is the last value of `source.cursor_field` the run checked (rows are
worked in ascending order of that column), `checked` is how many rows it looked at, `exhausted` is true
when it reached the end of the region's rows. Recorded once per `batch_id`, against the target the batch
was run for.

```json
{ "batch_id": "2026-W48", "leads": [ ... ], "progress": { "cursor": "CR700120", "checked": 140, "exhausted": false } }
```

Response:

```json
{ "batch_id": "2026-W47", "received": 55, "added": 48, "duplicates": 4, "suppressed": 1, "invalid": 0,
  "unverified": 2, "unverified_fields": ["verification.email"], "briefs_written": 48, "replayed": false }
```

- Re-sending the same `batch_id` returns the first result and adds nothing (safe retries).
- Skipped: businesses already on file (domain, phone, or name + ZIP) and anyone ever marked
  do-not-contact (permanent suppression list, kept even if the lead is deleted).
- Briefs not finished within the request are written by the daily sales job.

## What "verified" means (and doesn't)

Each fact is matched to a public page the agent read, and the page is stored with the lead so a rep can
click through. Good sources: the state contractor licensing board (license holder, business phone),
the Secretary of State business filing (owners/organizers, formation date), and the company's own
website (published business email and phone). It does **not** mean the email inbox was confirmed to
exist or that the person will answer: that needs a paid email-verification service, which we haven't
added. Expect fewer than 50 some weeks; the agent must not pad the list with unverified leads.

Rules the agent follows: public business information only, respect each site's terms and robots rules,
no guessed email addresses, no personal (non-business) emails or home addresses, no paid data broker
scraping. Reps who call: manual dialing only (no autodialer or prerecorded calls to cell phones under
the TCPA), and honor do-not-contact immediately.

## Agent prompt (the weekly Claude routine)

> Every Monday: GET the import target. If `paused` or `resume.exhausted`, stop and report why.
>
> **Region target** (`mode` = "region"): download `source.url` (Iowa's is a zip with one CSV). Keep
> active rows in the state (`state_field`, `status_field` in `active_status` when given) inside the
> region: `match_by` "county" → the `county_field` value is one of `region.counties` (compare case-
> insensitively); `match_by` "zip" → the first 5 digits of `zip_field` are in `region.zips`. If `trade`
> is set, keep rows whose `trade_field` fits it (or check the business's site). Sort by `cursor_field`
> ascending and start after `resume.cursor` (from the top when null). Work down the list until `count`
> leads are verified or the list ends; every row looked at counts toward `checked`.
>
> **ZIP target**: find small contractor businesses in `trade` within `radius_miles` of `zip`, as before.
>
> For each business confirm from public sources: owner name (license record, state business filing or
> company site), a business email and a 10-digit business phone (both required: from the license file
> when present, otherwise published by the business itself; website optional), trade, and business start
> date (from the company site, or the license / registration date in `start_date_field`). Record each
> fact's URL under `verification` (for a fact taken from the license download, cite `source.url`).
> Never guess an email. POST the verified leads with `batch_id` = the ISO week (e.g. 2026-W48) and
> `progress` = { cursor: the last `cursor_field` value checked, checked, exhausted }, then report the
> counts returned.

## Files

- `supabase/migrations/20270109101000_sales_lead_import.sql`, `20270114001000_sales_lead_regions.sql` (rollbacks in `supabase/rollback/`)
- `src/app/api/sales/leads/import/route.ts`, `src/lib/sales/import.ts`, `src/lib/sales/brief.ts`
- `src/components/sales/lead-target-form.tsx`, `src/lib/sales/lead-target-actions.ts` (Hub target form)
- Tests: `tests/db/sales-lead-import.test.ts`, `tests/db/sales-lead-regions.test.ts`, `tests/sales-lead-import.test.ts`
