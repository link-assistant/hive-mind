---
'@link-assistant/hive-mind': minor
---

Verify and repair the GitHub file links a session publishes into its pull request, so screenshots committed to a fork stop rendering as broken images (issue #2239).

In `Godmy/frontend#2` the branch `issue-1-46ba053c` and its three screenshots live only in the head repository `konard/Godmy-frontend`, while the description linked them at `github.com/Godmy/frontend/blob/issue-1-46ba053c/...`. That path answers `No commit found for the ref issue-1-46ba053c (HTTP 404)`, so every embedded image rendered broken. The fork-aware `screenshotRepoPath` shipped for #1561 was correct in the prompt — the log shows it naming the fork — and the wrong repository was still published, because nothing verified the link after it was written. The full reconstruction, with log line numbers and live 404/200 evidence, is in `docs/case-studies/issue-2239/`.

- **`src/pr-image-link-repair.lib.mjs` checks each published link against the API and repairs only what it can prove is wrong.** Links are collected from Markdown embeds, HTML `<img src>` and `raw.githubusercontent.com` URLs; a link is rewritten to the head repository only when `repos/{owner}/{repo}/contents/{path}?ref={ref}` answers 404 as written *and* 200 in the head repository. An unreachable API, an unknown answer or a file missing from the fork leaves the body untouched, so the repair can never invent a link. Probe results are memoized, kept out of the attached log via `quietProbe` (#2130), and every write is passed through `sanitizeForPublication` (#1745).
- **It runs at session end over the pull request body and the bot's own comments**, from `showSessionSummary`, reporting each `from → to` it changed and, under `--verbose`, how many links it checked.
- **The prompt now says the fork rule in words, not only by example.** `buildForkScreenshotLinkWarning` adds a fork-only warning to all six tool prompt builders; the log for this issue shows the upstream path appearing 90 times against the fork's 16, and a context compaction that carried the rule forward while dropping which repository it applied to.
