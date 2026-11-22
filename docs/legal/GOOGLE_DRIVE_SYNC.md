# Google Drive copy of legal documents

James's Google Drive folder **Built2bid → Company Documents** is the single place for company documents
(legal, due diligence, policies and runbooks, marketing, financial, product). Each area has an **Active**
folder (current version only) and an **Archive (old versions)** folder. Nothing is deleted.

Naming: `<Document name> — v<YYYY-MM-DD>` (the document's own version date). A replaced file moves to
Archive with ` (superseded YYYY-MM-DD)` added.

## Published legal pages: automatic

`docs/legal/drive-sync/LegalDriveSync.gs` is a Google Apps Script running hourly in James's Google account
("Built2Bid Legal Drive Sync" on script.google.com). For each page in its `PAGES` list it reads the live page
on built2bid.org, and when the text changed it moves the old Doc from
*01 Legal / Published Policies (live site) / Active* to *Archive (old versions)*, saves the new text as a new
Google Doc in Active, and logs the change in the **Legal Sync Change Log** sheet. It reads public pages only,
stores no keys, and costs nothing.

Flow: merge a legal change → Netlify deploys → within an hour Drive has the new version in Active and the old
one in Archive.

## When you change legal text (PR checklist)

1. Update `src/lib/legal/registry.ts` (version, dates, history), as before.
2. **New public legal page?** Add it to the registry *and* to `PAGES` in `docs/legal/drive-sync/LegalDriveSync.gs`.
   `tests/legal-drive-sync.test.ts` fails until you do. Then paste the updated script into the Apps Script
   project (script.google.com → Built2Bid Legal Drive Sync → Code.gs → Save).
3. **Agreement or disclosure that is not a public page** (staff agreements, affiliate agreement, sales comp,
   DPA, in-app disclosures)? After merge, put the new version in
   *01 Legal / Agreements and Program Terms / Active* and move the old one to Archive (Claude threads do this
   with the Google Drive connector).

## Setting it up again

1. script.google.com → New project → name it "Built2Bid Legal Drive Sync".
2. Paste `LegalDriveSync.gs` into Code.gs and save (no extra services or settings needed).
3. Run `setup` and click Allow. The first run only records a baseline; later runs archive and replace.
