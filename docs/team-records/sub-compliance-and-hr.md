# Sub compliance and HR files

## Turning it on

1. Set `PII_ENCRYPTION_KEY` in Netlify (Site configuration → Environment variables, Production, marked secret).
   Make it with `openssl rand -base64 32`. Never change it once numbers are stored: they couldn't be read back.
   Without it, everything else works and the full TIN / SSN / online W-9 parts say "Coming soon".
2. Run, in order, in the Supabase SQL Editor:
   - `supabase/migrations/20270103001000_fin_timesheet_labor.sql`
   - `supabase/migrations/20270104001000_sub_compliance.sql`
   - `supabase/migrations/20270105001000_hr_files.sql`
3. Redeploy so the new env var is picked up.

Rollbacks run newest first: `docs/team-records/rollback_20270105001000.sql`, `docs/team-records/rollback_20270104001000.sql`,
`docs/financials/rollback_20270103001000.sql`.

## Who sees what

| Data | Who |
| --- | --- |
| Sub W-9 details, certificates, request links, full TIN, 1099 e-file | Owner + "Manage subcontractor compliance" |
| HR files, employee SSNs, HR documents, certifications, time off | Owner + people the owner ticks on HR files → "Who can open HR files" |

Full TINs and SSNs are AES-256-GCM encrypted by the server before they reach the database (`pm_sensitive_ids`,
service role only). The app shows the last 4. Every save, view, export and removal is written to
`pm_sensitive_access_log` by `pm_sensitive_log`, which runs as the signed-in user and refuses anyone not allowed,
before the server reads the encrypted value. HR changes are recorded in `pm_hr_audit` with field names only.

Nothing here appears in the full data export, the activity feed, analytics or logs. The 1099 e-file CSV is the only
file with full TINs; each download is logged per sub.

## Sub self-serve link

Sub record → Request documents. The sub gets a one-time link (14 days; only its SHA-256 hash is stored) to fill in
a W-9 online and upload certificates. Emailed under the company's name when customer email is on; otherwise copy it.

## Expiry emails

The daily tax/banking cron emails the account owner once per document when a sub certificate is 30 days from
expiry, 7 days from expiry, and expired (only while customer email is on).
