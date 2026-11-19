---
'@link-assistant/hive-mind': minor
---

Wait for automated PR review apps and act on their findings (#4081).

- New `--review-bots` option. It is an allowlist of review apps and defaults to the Codex connector, CodeRabbit, Copilot review, Gemini Code Assist, Sourcery, Qodo, Cursor and Greptile. Use `default,<login>` to add an app, or `none` to turn this off. Summaries and reviews from these apps that report findings (the Codex `codex-review-state` marker with `has_unresolved_findings: true`, or CodeRabbit's `Actionable comments posted: N`) are feedback for `--auto-restart-until-mergeable`. CI and deploy bots stay ignored.
- Before "Ready to merge", the loop waits while a review app is still reviewing the head commit (a 👀 reaction or an in-progress notice). The wait lasts up to `--review-bots-wait-minutes`, default 15.
- Findings restart the AI. If the AI leaves them unaddressed, "Ready to merge" becomes "Ready for review — blocked by review bot findings", which names each summary, and `--auto-merge` does not merge.
- Every backend's system prompt now tells the AI to wait for review apps after marking the PR ready or pushing, and to address every finding.
