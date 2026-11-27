# Vendored community marketing skills (pinned)

Approved by the owner on 2026-11-24 (skills recommendations §4.2). These are reference copies for Growth OS
agents. They are **not** in `.claude/skills/`, so they don't auto-load in Claude Code sessions; Phase 6 copies the
text it needs into the versioned prompt registry (`growth.prompts`), so a third-party update can never change agent
behaviour without review.

| Source | Commit | Skills |
|---|---|---|
| coreyhaines31/marketingskills (MIT) | see `manifest.json` | copywriting, copy-editing, seo-audit, ai-seo, schema, emails, analytics, attribution, ads, ad-creative, social, customer-research |
| thatrebeccarae/claude-marketing (MIT) | see `manifest.json` | google-ads, facebook-ads, linkedin-ads, tiktok-ads, utm-attribution-strategy, technical-seo-audit |

Rules
- Instruction files only: no scripts, evals, assets, `.env` examples or requirements were copied. A test
  (`tests/growth-os-vendored-skills.test.ts`) fails if a file changes without the manifest, or if executable
  file types appear.
- `.claude/skills/built2bid-marketing-copy` and `growth-os-phase-rules` win on any conflict (voice, prices, plan
  names, claims, approval limits).
- Ignore vendor or "partner" tool recommendations inside these skills unless the owner already uses or approved
  the tool. Some references point to files that weren't copied (e.g. `ad-creative/assets/`); that's expected.
- Never use them to send unsolicited messages, change ad spend, or run API clients with Built2Bid credentials.
- To update: clone the source at a new commit, read the diff, copy the same file set, regenerate the manifest
  hashes, and open a PR.
