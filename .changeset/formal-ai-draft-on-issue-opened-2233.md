---
'@link-assistant/hive-mind': minor
---

Open a Formal AI draft for every new issue (#2233).

`.github/workflows/formal-ai-draft.yml` triggers on `issues: opened` — not on a curated label — and runs `solve --tool agent --model formal-ai --attach-logs --verbose --attribution formal-ai` in the published `konard/hive-mind` image, so every new issue gets one attempt within minutes on a branch nobody depends on. The commit carries the four Formal AI trailers and the evidence bundle (#2229, #2230), authored by `github-actions[bot]`; the pull request is put back into draft afterwards, so it cannot be merged by hand.

The decision of whether to attempt is a tested pure function (`scripts/formal-ai-draft.lib.mjs`): bot-authored issues, pull requests, the `no-formal-ai-draft` opt-out label and already-drafted issues are skipped, and a repository without the `FORMAL_AI_DRAFT_TOKEN` secret skips rather than fails, so forks stay green. The failure policy — a failed draft stays open and red, is never hand-corrected and merged, and a poor draft is closed with the defect filed against the meta algorithm — is written down in `docs/FORMAL-AI-DRAFTS.md` and its three translations.
