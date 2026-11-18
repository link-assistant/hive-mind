# Case study: issue #4082 — review findings, merge prerequisites and git hooks that needed a human

- Issue: https://github.com/link-assistant/hive-mind/issues/4082
- Pull request: https://github.com/link-assistant/hive-mind/pull/4083
- Related: #4081 (review-bot awareness, the feature request behind cases 1–5), #3924 and #3911 (merge-order prerequisites, case 6), #2809 and #2838 (OOM notices, case 8)
- Regression tests:
  - [`tests/issue-4082-review-feedback.test.mjs`](../../../tests/issue-4082-review-feedback.test.mjs) (cases 1, 3, 4, 5)
  - [`tests/issue-4082-review-gate.test.mjs`](../../../tests/issue-4082-review-gate.test.mjs) (cases 1, 2, 3, 5, 6)
  - [`tests/issue-4082-git-hooks-corepack.test.mjs`](../../../tests/issue-4082-git-hooks-corepack.test.mjs) (case 7)
  - [`tests/issue-4082-prompt-logging.test.mjs`](../../../tests/issue-4082-prompt-logging.test.mjs) (review feedback: final prompts in the log)
- Experiments:
  - [`experiments/issue-4082-prerequisites-parse.mjs`](../../../experiments/issue-4082-prerequisites-parse.mjs): which sentences count as merge prerequisites
  - [`experiments/issue-4082-command-stream-quoting.mjs`](../../../experiments/issue-4082-command-stream-quoting.mjs): how the GraphQL query survives command-stream quoting
  - [`experiments/issue-4082-audit-final-prompts.mjs`](../../../experiments/issue-4082-audit-final-prompts.mjs) and [`experiments/issue-4082-audit-other-prompts.mjs`](../../../experiments/issue-4082-audit-other-prompts.mjs): line counts, long lines and markdown in every prompt (`--print` dumps the solve prompts)
  - [`experiments/issue-4082-live-frame-text.mjs`](../../../experiments/issue-4082-live-frame-text.mjs): how a live stream-json frame is printed
  - [`experiments/issue-4082-run-related-tests.sh`](../../../experiments/issue-4082-run-related-tests.sh): runs the tests this change touches

The issue lists eight cases, collected while operating solve 2.39.x with `--auto-restart-until-mergeable`. In each one a human had to step in. The issue accepts each case once it has a regression test or is closed as a duplicate with a link.

## 1. Root causes

### 1.1. Bot output was never feedback (cases 1, 2)

`checkForNonBotComments` (`src/solve.auto-merge-helpers.lib.mjs`) dropped every comment whose author ends in `[bot]`. It read only issue comments and inline review comments, never PR reviews. A review app's P1/P2 finding was therefore invisible, both as an inline comment and as a `CHANGES_REQUESTED` review.

The watch loop also started its "new since" window (`lastCheckTime`) after the initial cooldown. A review app usually answers 60–120 s after the PR is marked ready, which is inside that cooldown. So even a non-bot comment posted then was older than the window and was skipped.

### 1.2. The loop ended at "Ready to merge" (cases 2, 3)

Without `--auto-merge`, `watchUntilMergeable` returned as soon as it posted "✅ Ready to merge". A review that arrived later (a bot re-reviewing the new head an hour after the push, or a human posting a BLOCK review) found no process watching. The same-account trust from #1821 (`trustAuthenticatedUserComments`) only applied while the loop ran.

### 1.3. Session-start feedback filtered by age (case 4)

`detectAndCountFeedback` (`src/solve.feedback.lib.mjs`) counted review comments and `CHANGES_REQUESTED` reviews only when they were newer than the last commit. Any later commit, even a merge of the default branch, hid an unaddressed finding from the next session's prompt. Its thread was still open on GitHub.

### 1.4. Nothing asked the AI to resolve threads, and nothing read thread state (case 5)

The prompt asked the AI to reply to review comments but never to resolve the thread. No code path read `reviewThreads { isResolved }`. So a reply with a fix and a finding that was ignored looked the same.

### 1.5. "Ready to merge" checked only CI, conflicts and the working tree (case 6)

The comment's checklist covered CI, mergeability and uncommitted changes. A prerequisite stated by the session itself ("merge the companion PR first") or a `Depends on #N` line in the PR description was never read.

### 1.6. Node 26 has no corepack, and the image skipped it on purpose (case 7)

Node ≥ 25 no longer bundles corepack. The Dockerfiles re-install the globals inherited from the base image but skipped `corepack@*`, so `command -v corepack` found nothing. A repository that pins `packageManager: pnpm@…` and runs lefthook failed every commit with `spawnSync corepack ENOENT`. Nothing told the AI that the hooks could not run, so their checks were either bypassed silently or skipped without notice.

## 2. Fixes, per case

| Case                                        | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Regression test                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Bot finding before "Ready to merge"      | The loop reads unresolved review threads (GraphQL, paginated, any author including bots) on every check. A thread the AI has not seen restarts it, with the thread in the feedback. `checkForNonBotComments` also reads PR reviews, and a bot `CHANGES_REQUESTED` review counts. The feedback window now opens before the cooldown.                                                                                                                                                                                                                                                               | `review-feedback`: "case 1: the watch loop restarts on a review bot that requests changes after the last check"; `review-gate`: "cases 1 and 5: new threads are fresh once" and "cases 1–3: the watch loop wiring" (`lastCheckTime` before the cooldown, `hasNewReviewThreads` in the ready condition)            |
| 2. Bot re-review after the loop exited      | New option `--auto-restart-until-mergeable-review-window-minutes` (default 120). Without `--auto-merge`, the loop keeps watching that long after "Ready to merge". A new thread, review or comment in that window restarts the AI. A restart or a new commit starts a new window. `0` restores the old exit.                                                                                                                                                                                                                                                                                      | `review-gate`: "case 2: the review window keeps the loop watching after "Ready to merge", and restarts reopen it", and the window `continue` in "cases 1–3: the watch loop wiring"                                                                                                                                |
| 3. Human review after "Ready to merge"      | The review window above, and `checkForNonBotComments` treats same-account reviews and comments without tool markers as human feedback (`trustAuthenticatedUserComments: true` is passed from the loop).                                                                                                                                                                                                                                                                                                                                                                                           | `review-feedback`: "case 3: a human review and a same-account comment without tool markers after "Ready to merge" restart the loop"; `review-gate`: `trustAuthenticatedUserComments: true` in "cases 1–3: the watch loop wiring"                                                                                  |
| 4. Findings older than the last commit      | Session-start feedback lists every unresolved review thread and every outstanding `CHANGES_REQUESTED` review (the latest review per reviewer), whatever their age.                                                                                                                                                                                                                                                                                                                                                                                                                                | `review-feedback`: "case 4: session-start feedback lists unresolved threads older than the last commit" and "case 4: a change request stays outstanding until the same reviewer approves, however old it is"                                                                                                      |
| 5. Threads replied to but never resolved    | The prompt lists each thread with its id and the exact `resolveReviewThread` command, and tells the AI to resolve a thread after a verified fix (or to reply and leave it for the reviewer when the finding does not apply). A thread the AI was given and left unresolved holds the PR back: the loop posts "🟡 Ready for review — blocked by unresolved review threads" instead of "Ready to merge", and with `--auto-merge` it does not merge.                                                                                                                                                 | `review-feedback`: "case 5: the prompt names each thread with its id and tells the AI to resolve it after a verified fix" and "case 5: a thread is restarted on once; later it is only named for a human"; `review-gate`: "cases 1 and 5: new threads are fresh once; a failed read holds nothing back"           |
| 6. Merge-order prerequisite ignored         | `src/merge-prerequisites.lib.mjs` reads "merge … first", "depends on", "blocked by", "requires … to be merged" and similar lines in the PR description and in the latest session summary, then checks each referenced PR or issue on GitHub (merged / closed). Unmet ones are named in the "Ready for review — blocked by merge prerequisites" comment (posted by `src/solve.auto-merge-ready-comment.lib.mjs`, again only when the holds change), and block `--auto-merge`. Option `--check-merge-prerequisites` (default on).                                                                   | `review-gate`: positive and negative parsing, `checkReferenceState`, `checkMergePrerequisites`, the blocked comment, "the ready comment is posted once per head SHA, and the blocked one again only when its holds change", and the dedup signature that keeps it apart from the plain "Ready for review" comment |
| 7. `spawnSync corepack ENOENT` in the image | Both Dockerfiles install a pinned `corepack` (`HIVE_MIND_COREPACK_VERSION`) before the inherited globals, so an explicitly installed pnpm or yarn keeps priority over corepack's shims. `scripts/verify-docker-image.sh` requires `corepack --version`, and the dependency-freshness check tracks the pin. Solve also runs a read-only preflight after the clone (`src/git-hooks-preflight.lib.mjs`). It finds lefthook, husky, pre-commit and simple-git-hooks configuration, names every tool they need that is missing, and tells the AI to run those checks by hand instead of skipping them. | `git-hooks-corepack`: the lefthook + pnpm incident, the fixed image, husky / pre-commit / simple-git-hooks, `node_modules/.bin`, solve wiring, both Dockerfiles, the verify script and the freshness pin                                                                                                          |
| 8. OOM notice after "Ready to merge"        | Duplicate of #2809 and #2838, as the issue itself says. No code change here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Covered by those issues                                                                                                                                                                                                                                                                                           |

## 3. Behavior and options

- `--auto-restart-on-unresolved-review-threads` (default `true`): unresolved review threads restart the AI the first time they are seen. Afterwards they hold "Ready to merge" back.
- `--auto-restart-until-mergeable-review-window-minutes` (default `120`, `0` turns it off): how long the loop keeps watching after "Ready to merge" when `--auto-merge` is not set.
- `--check-merge-prerequisites` (default `true`): read declared merge-order prerequisites and hold "Ready to merge" until they are met.

Every new GitHub probe fails open. If review threads or prerequisites cannot be read, the loop logs a warning and does not hold the pull request back, so an API error cannot stall a ready pull request.

Each thread restarts the AI once. A thread that is still unresolved after that becomes a hold, not another restart, so a finding the AI rightly declines cannot loop the session.

## 4. How to reproduce the original behavior

1. Open a PR with `solve --auto-restart-until-mergeable` (no `--auto-merge`).
2. Within two minutes of the session marking the PR ready, post an inline review comment from a bot account (or a `CHANGES_REQUESTED` review).
3. Before this change: "✅ Ready to merge" is posted and the loop exits. After this change: the loop restarts the AI with the thread in its feedback. If the AI leaves the thread unresolved, "🟡 Ready for review — blocked by unresolved review threads" is posted instead.
4. Post a review an hour after "Ready to merge". Before this change, nothing happened. Now the review window (120 minutes by default) restarts the AI.

## 5. Review feedback: every final prompt in the log

The pull request review asked that every prompt sent to an AI tool be clearly marked in the log and printed in full after all formatting, even when it goes through a file. The prompts themselves must stay human-readable multi-line plain text without markdown.

Root cause: Codex, Agent, OpenCode and Gemini write the combined system and user prompt to a temporary file or stdin. Qwen reads both from files through `"$(cat file)"`. They logged only the file path or the prompt length. The full text was printed only with `--dry-run`, and only with `--verbose`. Claude printed its prompts only with `--verbose`. Live input frames, agent-commander, the task command and the /organize classifier never printed their prompts.

Fix: `src/prompt-log.lib.mjs` formats one block per prompt:

```
📋 Final user prompt sent to claude: 12 lines, 651 characters, delivered via the -p argument
---BEGIN USER PROMPT---
…the exact text the tool receives…
---END USER PROMPT---
```

Every runner logs these blocks right where the prompt is sent, at the normal log level, dry runs included. Each block holds the exact text: the combined message for tools that take one, the geolocation policy that agent-commander and start-agent append, and Qwen's prompts with the trailing newlines that `$(cat …)` drops. The bidirectional handler prints every frame it writes to the tool stdin (stream, queue flush and feedback) as a `LIVE INPUT PROMPT` block. It skips the initial frame, which the runner already logs. The /organize classifier forwards the blocks to the bot log through a new optional `log` callback. They are kept out of the audit record, which stays free of issue content.

Formatting: `experiments/issue-4082-audit-final-prompts.mjs` shows that the solve prompts of all six tools are already multi-line plain text with no markdown headings, bold, links or tables (user prompts are about 12 lines, system prompts 121 to 142). The few long lines are prose paragraphs. The /organize user prompt was the exception: its context and issues were minified JSON on one line each. It now uses indented JSON, and the chunker measures that formatted size, so `maxCharacters` still bounds the real prompt. The regression test locks in both properties.

## 6. Remaining limits

- After the review window closes, a review still needs a manual restart. The window is a bounded watch, not a permanent subscription. Raise the option, or use `0` to keep the old behavior.
- Prerequisite detection reads English phrasing and GitHub references (`#N`, `owner/repo#N`, PR and issue URLs). A "merge … first" line without a reference cannot be checked on GitHub. It is named with "no link to check, so confirm it manually" and keeps holding until the description or a later session summary no longer declares it. "Depends on" and "blocked by" lines count only when they carry a reference.
- The git-hooks preflight checks only that tools exist. It does not run the hooks.
