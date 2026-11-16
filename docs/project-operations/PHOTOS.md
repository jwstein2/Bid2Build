# Project photos (V4.3)

- Stored only in Built2Bid: private Supabase Storage bucket `project-photos`, paths prefixed by company (or user) id. No third-party storage.
- Upload: up to 10 files per request, 10 MB each. Files are sniffed by content, re-encoded with sharp (JPEG ≤2400px + WebP thumbnail 480px) and all metadata, including GPS location, is removed.
- Access: RLS on `project_photos` follows the bid/customer: anyone who can read the project may view; uploading/editing needs `can_upload_photos` (bid author, or company roles with the photo permission). Images are served through short-lived signed URLs (1 hour).
- Captions, dates, labels and scope-section links are editable; archive hides a photo without deleting it.
- Uploads never change costs, prices or anything customer-facing.

## AI label suggestions (off by default)
- Turned on only with `PHOTO_AI_LABELS=on` and a configured `ANTHROPIC_API_KEY`. Model: `PHOTO_AI_MODEL`, default Claude Haiku.
- Runs only when a person taps "Suggest labels"; the drawer discloses that a small preview is sent to Anthropic.
- Suggestions are limited to a fixed vocabulary, stored separately as `ai_labels`, and only become labels when accepted.
- Each call is logged in `ai_generations` (kind `photo_labels`) and respects the monthly AI budget.
