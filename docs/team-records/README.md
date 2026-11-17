# Team records: suppliers, employees & time, subcontractor records, 1099 totals

Projects → Team & Subcontractors now has five sections: People & subs, Employees & time, Suppliers, Sub records, 1099 totals.

- **SQL:** `supabase/migrations/20261210001000_team_records.sql` (rollback: `rollback_20261210001000.sql` here).
- **Suppliers** (`pm_suppliers`): company-wide (or solo). Price imports link to a supplier: chosen in the import's supplier box, or found / added by name after the import. Older imports match by name.
- **Employees & time:** Staff entries are the employee list (archive, never delete). `pm_employee_profiles` holds title, pay type, hourly cost rate (managers only), hire date, emergency contact. `pm_time_entries` is the time clock: own punch (linked login) or a manager punch for crew without a login; one open punch per person; managers add/fix with a reason (logged in `pm_time_entry_changes`), approve, send back, reopen; people don't approve their own time unless they're the company owner. Location is saved only at a punch when the person ticks the box, and cleared after 90 days. `next.config.ts` Permissions-Policy now allows `geolocation=(self)` for this.
- **Labor cost:** approved hours × hourly cost rate, per project, shown on the timesheet. Not yet posted into Financials job costs (follow-up, to avoid clashing with the accounting work).
- **Payroll:** a payroll-preparation CSV (hours per person per week, hours over 40). No pay or tax calculation.
- **Sub records:** `pm_sub_tax_profiles` stores W-9 details with **only the last 4 digits** of the SSN/EIN. Files (W-9, certificates, agreements) go to the private `sub-records` bucket via the server and open through 60-second signed links after `pm_sub_document_file` checks permission. Access: company owner or "Manage subcontractor compliance" (company role or financial seat). Everyone who can see the directory gets only the at-a-glance badges. Wording is "on file", never "verified"; nothing blocks payments.
- **1099 totals:** bill payments + approved expenses in the calendar year from the live Financials book, card payments shown but not counted, threshold $600 through 2025 and $2,000 from 2026, corporations excluded by default (overridable per sub).
- **Tests:** `tests/db/team-records.test.ts`, `tests/team-records.test.ts`. Browser walk: `scripts/team-records/walk.mjs` (setup in `setup-db.mjs`).
