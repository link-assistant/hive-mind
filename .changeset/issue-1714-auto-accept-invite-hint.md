---
'@link-assistant/hive-mind': patch
---

Fix Telegram `/solve` repo-not-accessible message still suggesting `--auto-accept-invite` even when that flag is already active (issue #1714). After issue #1694 flipped `--auto-accept-invite` to default-on, `src/telegram-bot.mjs` was passing `autoAcceptInvite: args.some(a => a === '--auto-accept-invite')` to `validateGitHubEntityExistence()` — but the literal flag is no longer present in the typical default-on invocation, so the suppression added by issue #1692 silently regressed. The call now reads `parsedSolveArgs?.autoAcceptInvite` (matching the auto-accept pre-check two lines above), so the hint is suppressed when the flag is active and only shown when the user explicitly opts out with `--no-auto-accept-invite`. Adds `tests/test-issue-1714-auto-accept-invite-hint.mjs` covering the parsed-argv contract and a source-level guard against the `args.some(...)` form returning, plus a case study under `docs/case-studies/issue-1714/`.
