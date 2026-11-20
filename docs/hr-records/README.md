# Complete HR records: employees and subcontractors

Migration `supabase/migrations/20270205001000_hr_records_complete.sql` (rollback `docs/hr-records/rollback_20270205001000.sql`,
run it before `docs/team-records/rollback_20270105001000.sql`). Builds on HR files (20270105001000), sub compliance
(20270104001000) and team records (20261210001000).

Benchmarked (Nov 2026) against what Gusto, ADP, Paychex, Rippling and BambooHR collect at onboarding, and what
construction compliance tools (Procore prequalification, Billy, Workyard) ask of subcontractors.

## Employees: what we keep (HR file, owner + HR managers only)

| Area | Fields | Where |
| --- | --- | --- |
| Directory | Name, work email, work phone, trades | People & subs |
| Job | Title, pay type, loaded hourly cost, hire date | Employees & time |
| Personal | Legal first/middle/last, preferred name, date of birth, personal phone and email, home address | HR file |
| Emergency | Two contacts: name, relationship, phone (+ alt phone for the first) | HR file |
| Employment | Type, status, department/crew, supervisor, work location, separation date/reason/rehire | HR file |
| **Pay and classification (new)** | Employee ID, pay rate + per hour/year, pay frequency, FLSA overtime status, trade classification (prevailing wage), workers' comp class code, union local, date reported to the state new-hire registry | HR file |
| Eligibility | I-9 completed on, reverify by | HR file |
| **Tax withholding (new)** | W-4 (2020+): filing status, multiple jobs, dependents amount, other income, deductions, extra withholding, exempt, signed on; state: withholding state, allowances, extra withholding, exempt | HR file |
| **Direct deposit (new)** | Bank name, account type, routing number (ABA checksum), account number **encrypted** | HR file |
| Sensitive | SSN **encrypted** | HR file |
| Documents | Application, résumé, offer letter, background check, drug test, W-4, state W-4, I-9, direct deposit form, handbook acknowledgment, licenses, certifications, reviews, warnings, medical/leave, separation | HR file |
| Certifications | Any name with issuer, number, issued/expires. Suggestions: driver's license, CDL, OSHA 10/30, First Aid/CPR, EPA RRP, EPA 608, forklift, aerial lift, fall protection, trade licenses… | HR file |
| Time off | PTO / sick allowances, requests and balances | HR file |

Not collected on purpose: EEO-1 voluntary self-ID (only 100+ employee / federal contractor firms), benefits
enrollment and actual payroll tax filing (those belong in the payroll provider).

## Subcontractors: what we keep (owner + "Manage subcontractor compliance")

| Area | Fields |
| --- | --- |
| Directory | Company or individual, contact, email, phone, trades, crew size |
| W-9 | Legal name, business name, tax classification, TIN type, full TIN **encrypted** (last 4 shown), address, signed date, 1099 tracking |
| **Business and payment (new)** | Payment terms, retainage %, backup withholding, EMR safety rating, years in business, certified business types (MBE, WBE, DBE, SBE, VOSB, SDVOSB, HUBZone, 8(a)), website, prequalified date, ACH bank / account type / routing, ACH account number **encrypted** |
| Insurance | GL, workers' comp, auto, umbrella: insurer, policy #, each-occurrence limit, **aggregate (new)**, effective/expiry, **additional insured, waiver of subrogation, primary & non-contributory (new)** |
| **New document types** | Workers' comp exemption certificate, bond, safety program / OSHA logs, prequalification form |
| Other documents | Contractor license (number, issuer, expiry), subcontract agreement, MSA, lien waivers, other |
| Self-serve | Request link for the sub to submit W-9 and certificates; expiry emails at 30 / 7 / 0 days |

## Bulk import (Projects → Team → Import)

* Templates: download from the page (`templateCsv`, one example row that the import skips). Column catalog and accepted
  values: `src/lib/team/import.ts` (`EMPLOYEE_COLUMNS`, `SUB_COLUMNS`); the page shows the same field guide.
* Upload CSV or .xlsx (≤ 1,000 rows, 5 MB). Common payroll / vendor export headers are recognized (First Name + Last
  Name builds the name). Unused columns are listed and skipped. Formula cells are refused.
* Preview shows Add / Update / Skip per row with plain-words problems; nothing is written until Import.
* Matching: same kind, by email first, then exact name; two entries with the same name and no email → row refused.
* Blank cells never erase saved values (W-9 and job details are merged before saving). Certificates already on file
  with the same policy number and expiry aren't added twice.
* Writes run as the signed-in user through the same database functions as the screens, 25 rows per request
  (`/api/team/import`). HR columns need the owner or an HR manager; W-9 / insurance / payment columns need
  "Manage subcontractor compliance". Otherwise the person is still added and the row gets a warning.
* SSN, TIN and bank account numbers are encrypted on arrival (PII_ENCRYPTION_KEY) and each save is logged with the
  note "CSV import". Without the key they are skipped with a warning (TIN keeps its last 4).
