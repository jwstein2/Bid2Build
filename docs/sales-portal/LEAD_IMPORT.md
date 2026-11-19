# Weekly lead import (Sales Portal Phase 3a)

A scheduled Claude agent finds verified contractor leads once a week near the owner's target ZIP and
trade and posts them to Built2Bid. They land **unassigned** in the owner's Sales Hub (Leads tab →
"Weekly lead import"), each with a short Haiku 5.5 sales brief, and the owner assigns them to reps.
Nothing is emailed or called automatically. None of this is visible to Built2Bid customers.

## 1. Owner sets the target (Sales Hub → Leads)

Active ZIP code (the dropdown suggests ZIPs where you already have leads), trade, radius (default 50
miles) and leads per run (default 50). "Pause" stops the run. With no ZIP set, the run waits.

## 2. Agent reads the target

```
GET https://built2bid.org/api/sales/leads/import
Authorization: Bearer $SALES_LEAD_IMPORT_SECRET
→ { "zip": "55401", "trade": "roofing", "radius_miles": 50, "count": 50, "paused": false }
```

If `paused` is true, the agent stops. `trade` null means any trade in the list.

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

## Agent prompt (draft for the weekly Claude routine)

> Every Monday: GET the import target. If paused, stop. Find up to `count` small contractor businesses
> in `trade` (or any residential trade if null) within `radius_miles` of ZIP `zip`. For each, confirm
> from public sources: owner name (state license board or Secretary of State filing), business email
> published by the business itself, business phone, business name, trade, and business start date
> (state filing). Record the URL where you confirmed each fact under `verification`. Include only leads
> where every required fact is confirmed; never guess. Add useful facts for a sales call to `notes`
> (services, service area, review rating if published). POST them with `batch_id` = the ISO week
> (e.g. 2026-W47) and report the counts returned.

## Files

- `supabase/migrations/20270109101000_sales_lead_import.sql` (rollback in `supabase/rollback/`)
- `src/app/api/sales/leads/import/route.ts`, `src/lib/sales/import.ts`, `src/lib/sales/brief.ts`
- Tests: `tests/db/sales-lead-import.test.ts`, `tests/sales-lead-import.test.ts`
