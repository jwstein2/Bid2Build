# Accessibility report (2026-11-13)

Target: WCAG 2.2 AA where practical. Method: code review of changed and core components, Playwright probe for target sizes, visual inspection of screenshots. No automated axe run and no screen-reader session (VoiceOver/TalkBack) were done; see REMAINING_ISSUES R-05.

| Area | Finding | Status |
|---|---|---|
| Accordion triggers (2.1.1, 4.1.2) | Real `<button>`s with `aria-expanded`, `aria-controls` pointing at the panel id, and labels naming the section ("Collapse Tear-off & prep"). Previously a generic "Collapse section". | Fixed |
| Hidden validation errors (3.3.1) | Collapsed sections with invalid entries show a visible "Needs attention" chip with icon + text (not color alone). The top alert (`role="alert"`) still lists all issues. | Fixed |
| Suggestion chips (4.1.2, 1.3.1) | Inside a labelled `<ul>`; each chip has an explicit label ("Add House wrap to this section", "House wrap is already in this section. Go to it.", "Hide suggestion House wrap"). Added state shown by icon + "Added" text. | New |
| Picker (4.1.2) | Added rows are `disabled` with label "…, already added to this section". Done button closes; Escape and outside click still close. | Fixed |
| Mobile menu (4.1.2) | Toggle has `aria-expanded`/`aria-controls`; visible text "Menu"/"Close" (screen-reader-only under 380px). Nav keeps `aria-current="page"`. | New |
| Target size (2.5.8, AA 24px) | On mobile: section toggles and menus 44px, item detail toggles and menus 44×32, chips 40px, account menu 44px, Delete buttons 44px, footer links ≥25px. Row checkboxes 20px inside a 44px label. Remaining under 24px: inline text links in sentences (exempt) and the proposal-settings checkboxes (13px boxes inside full-width labels). | Improved |
| Mobile card labels (1.3.1) | Inputs keep their existing `aria-label`s; the visible mini-labels ("Qty", "Unit") are `aria-hidden` to avoid double announcements. | New |
| Zoom on focus (iOS) | Card inputs use 16px text so iOS Safari doesn't zoom on focus. | New |
| Contrast (1.4.3) | New text uses existing tokens: `text-muted` cool gray on white and `text-ink` on teal-tinted chips; brand tokens were contrast-tested by `tests/brand-tokens.test.ts` (passes). | Pass |
| Focus visible (2.4.7) | New controls inherit the global focus ring; `.cell` inputs keep their focus border. Clicking an Added chip moves focus to the existing row's name field. | Pass |
| Reduced motion (2.3.3) | Only new motion is `scrollIntoView({behavior:"smooth"})` for Added chips; browsers honor `prefers-reduced-motion` for smooth scroll only partially. | Low risk, noted |
| Layout shift | Profile reminder and open-section restore render after hydration (storage read), which can shift content slightly on first paint. | Noted (R-06) |
| Performance / re-renders | `reconcileOpenState` returns the same object when nothing changed, avoiding extra renders; chips compute from props; no new dependencies. | Pass |
