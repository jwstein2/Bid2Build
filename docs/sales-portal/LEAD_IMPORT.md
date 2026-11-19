# Weekly lead import (Sales Portal Phase 3a)

A scheduled Claude agent finds contractor businesses once a week and posts them to Built2Bid. They land
**unassigned** in the owner's Sales Hub (Leads tab → "Weekly lead import"), where the owner assigns them
to reps. Nothing is emailed or called automatically.

## Endpoint

```
POST https://built2bid.org/api/sales/leads/import
Authorization: Bearer $SALES_LEAD_IMPORT_SECRET
Content-Type: application/json
```

`SALES_LEAD_IMPORT_SECRET` is a random string of at least 24 characters. Set it in Netlify (Production)
and in the agent's environment. Never put it in code, a prompt, or chat. Without it the route answers 401.

```json
{
  "batch_id": "2026-W47",
  "label": "Twin Cities roofers and remodelers",
  "leads": [
    {
      "company_name": "Summit Roofing",
      "contact_name": "Dana Lee",
      "email": "office@summitroof.com",
      "phone": "612-555-0100",
      "website": "https://summitroof.com",
      "city": "Minneapolis", "state": "MN", "zip": "55401",
      "trades": ["roofing"],
      "source_url": "https://summitroof.com/contact",
      "notes": "Residential re-roofs, 5 crews"
    }
  ]
}
```

- `company_name` and at least one of email, phone or website are required; other fields are optional.
- At most 1,000 leads per request. Send larger runs as several requests with different `batch_id`s.
- `batch_id` is the run's own id. Re-sending the same id returns the first result and adds nothing,
  so a retry after a timeout is safe.

Response:

```json
{ "batch_id": "2026-W47", "received": 120, "added": 85, "duplicates": 30, "suppressed": 2, "invalid": 3, "replayed": false }
```

## What gets skipped

- **Duplicates**: any business already on file (any rep, any stage), matched on website domain, phone,
  or name + ZIP.
- **Suppressed**: anyone marked do-not-contact, ever. Marking a lead do-not-contact adds its email,
  domain and phone to `sales_suppressions`, which survives even if the lead is deleted.
- **Invalid**: rows with no name or no way to contact.

## Agent prompt (draft)

> Every Monday, find up to 150 small residential contractor businesses (roofing, remodeling, decks,
> painting, concrete, landscaping, cleaning) in [target areas] that would benefit from bid and estimate
> software. Use only public business information: the company's own website and public business
> directories, respecting each site's terms and robots rules. Do not scrape sites that forbid it, do not
> collect personal (non-business) emails or phone numbers, and do not guess email addresses. For each
> business record company name, business contact name if published, business email/phone/website, city,
> state, ZIP, trades, and the page you found it on (`source_url`). Post them to the import endpoint with
> `batch_id` = the ISO week (e.g. 2026-W47) and report the counts it returns.

## Files

- `supabase/migrations/20270109101000_sales_lead_import.sql` (rollback in `supabase/rollback/`)
- `src/app/api/sales/leads/import/route.ts`, `src/lib/sales/import.ts`
- Tests: `tests/db/sales-lead-import.test.ts`, `tests/sales-lead-import.test.ts`
