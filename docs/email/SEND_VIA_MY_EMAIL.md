# Send via My Email

Lets a contractor send their proposal PDF from their own email app. Built2Bid never sends,
stores or reads these emails, never asks for Gmail/Outlook access, and adds no email cost.

## Flow

1. The contractor taps **Send via My Email** (builder header, proposal preview, last step).
2. Missing details (company name, customer, title, project address, priced items) are shown first,
   exactly like Download PDF.
3. The PDF is prepared through the normal export (`POST /api/estimates/[id]/export` with
   `{ "deliver": "bytes" }`). Same sign-in, verification, readiness checks and `finalize_bid`:
   - free-plan limits apply; no extra credits are issued
   - an unchanged, already-finalized proposal is not charged again, whether it was first downloaded
     or sent (same content hash → same version)
   - double taps are ignored while an export is running
   - the PDF is still stored privately as before; the bytes go straight to the browser, so no
     storage URL is shared
4. A dialog shows the prepared To / Subject / Message (editable, with Copy buttons).
5. **Attach automatically** (only when `navigator.canShare({ files })` is true, typically iOS/Android
   and some desktop browsers): a separate tap opens the system share sheet with the PDF. The share
   needs a fresh tap, which a slow export would otherwise use up, so the PDF is prepared first. The
   share sheet may list non-email apps, and some email apps drop attachments or ignore the subject;
   the dialog says so and never claims the email was sent.
6. **Fallback (always shown):** Download PDF, then Open email draft (a `mailto:` link with the
   recipient, subject and message, fully percent-encoded). `mailto:` can't attach files, so the
   contractor attaches the downloaded PDF. If no email app is set up, nothing opens and the dialog
   points to the Copy buttons.

Message: `src/lib/proposal/share-email.ts` (uses only fields the contractor entered; missing
fields are left out).

## Cost

No new services. Each send is one normal PDF export (same storage as Download PDF; the PDF is
also returned in the response, typically tens of KB, so bandwidth roughly doubles for that one
request).

## Platform support

Feature detection decides at runtime. Automatic attachment was verified with a simulated
`navigator.share` in Chromium; it has **not** been verified on real iOS/Android devices yet.
