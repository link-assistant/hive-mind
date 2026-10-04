# Issue 2492: misleading and verbose communication to the user

On 2026-10-04 at 12:00:59 UTC, solve v2.33.11 posted this comment on [link-foundation/meta-language#196](https://github.com/link-foundation/meta-language/pull/196) ([screenshot](screenshot.png)):

> 🤖 **AI Work Session Started**
>
> Starting automated work session at 2026-10-04T12:00:55.290Z
>
> The PR has been converted to draft mode while work is in progress.
>
> _This comment marks the beginning of an AI work session. Please wait for the session to finish, and provide your feedback._
>
> _Runtime: solve `v2.33.11` · tool `claude` · model `opus` · task image `konard/hive-mind-dind:2.33.11@sha256:9994…0288`_

The issue reports three problems with it:

1. "Starting" is wrong: the session had already started when the comment was posted.
2. The draft sentence is not checked, and GitHub already shows the state change.
3. The runtime line is noise: the log already records it.

The issue then asks for an audit of every user-facing message, looking for unchecked or wrong claims and needless words.

The fixes and regression tests are in [PR #2493](https://github.com/link-assistant/hive-mind/pull/2493). The main test is [`tests/issue-2492-concise-truthful-messages.test.mjs`](../../../tests/issue-2492-concise-truthful-messages.test.mjs).

## Data in this folder

| File                                                                       | What it is                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`screenshot.png`](screenshot.png)                                         | The screenshot from the issue                                                                                                          |
| [`meta-language-pr-196-comments.json`](meta-language-pr-196-comments.json) | All 188 comments on meta-language#196 (GitHub REST `issues/196/comments`)                                                              |
| [`meta-language-pr-196-timeline.json`](meta-language-pr-196-timeline.json) | The timeline of meta-language#196 (GitHub REST `issues/196/timeline`), including every `convert_to_draft` and `ready_for_review` event |
| [`draft-claims-vs-timeline.tsv`](draft-claims-vs-timeline.tsv)             | Each of the 17 "converted to draft mode" comments next to the latest draft event before it                                             |

## Timeline (UTC)

| Time                | Event (evidence)                                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-23 13:55:19 | First `convert_to_draft` event on meta-language#196 by solve. Two seconds later, comment 5796139121 says the PR "has been converted to draft mode". This repeats what the GitHub timeline already shows. Twelve more pairs like this follow. |
| 2026-09-25 17:47:51 | Comment 5836892716 says the PR "has been converted to draft mode". The last draft event was a `convert_to_draft` at 09-25 00:29:39, **17 hours earlier**. The PR was already a draft and nothing was converted.                              |
| 2026-09-27 15:26:43 | The same false claim (5857183448). The PR had been a draft since 09-26 06:54:09.                                                                                                                                                             |
| 2026-09-27 18:37:42 | The same false claim (5858631439).                                                                                                                                                                                                           |
| 2026-09-29 10:56:42 | The same false claim (5888797940). The PR had been a draft since 06:55:42.                                                                                                                                                                   |
| 2026-10-04 12:00:55 | A new session starts; the comment's timestamp is taken here.                                                                                                                                                                                 |
| 2026-10-04 12:00:57 | GitHub records `convert_to_draft`.                                                                                                                                                                                                           |
| 2026-10-04 12:00:59 | The reported comment 5979703717 is posted: "Starting…", the draft sentence and the runtime line. 17 of the 188 comments on the PR carry the same runtime line.                                                                               |
| 2026-10-04 13:09:16 | Issue #2492 is opened.                                                                                                                                                                                                                       |

Summary of [`draft-claims-vs-timeline.tsv`](draft-claims-vs-timeline.tsv):

- **4 of 17** draft claims were false. The PR was already a draft, and no conversion happened within 4 to 36 hours.
- The other **13** were posted 1–4 s after GitHub's own `convert_to_draft` event, so they repeated what the PR timeline already showed.

## Requirements from the issue

| #   | Requirement                                                                              | Status                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Say the session _started_, not that it is _starting_                                     | Fixed (root cause 1)                                                                                                                                                          |
| R2  | No "converted to draft mode" sentence: it can be false and GitHub already shows it       | Removed from all four session comment types (root cause 2)                                                                                                                    |
| R3  | No runtime line by default; concise messages without `--verbose` / `--attach-logs`       | The line is always written to the log, and goes into the comment only with `--verbose` (root cause 3). Footers that repeat the heading were removed everywhere (root cause 5) |
| R4  | Audit every user-facing message for unchecked or wrong claims; add checks or remove them | 12 more findings fixed (root causes 4–11). Kept messages are listed with reasons in [Audited and kept](#audited-and-kept)                                                     |
| R5  | Be precise, concrete, short                                                              | Every changed message is shorter, see the before/after list in PR #2493                                                                                                       |
| R6  | Before/after preview of all changes in the PR description                                | PR #2493 description                                                                                                                                                          |
| R7  | Case study with data, timeline, requirements, root causes, solutions, research           | This document                                                                                                                                                                 |
| R8  | Debug output where the root cause cannot be proven                                       | Not needed: every root cause here is proven from the source code and the PR data. The runtime line, removed from comments, is still logged (`🧾 Runtime:`)                    |
| R9  | Report problems that belong to other repositories                                        | None found. All messages are produced by hive-mind itself (see [External issues](#external-issues))                                                                           |
| R10 | Apply each fix everywhere it occurs                                                      | Shared builders are used by every code path that posts the message, and the test checks the sources for the removed phrases                                                   |

## Root causes and fixes

### 1. Present-tense text written after the fact

`getSessionCommentContent` in `src/solve.session.lib.mjs` built "Starting / Resuming / Auto-resuming / Auto-restarting automated work session at X". The comment is posted only after the session has started, so it now uses the past tense: "Started at X.", "Resumed at X …", "Restarted at X …".

### 2. The draft sentence was hard-coded

All four session types appended "The PR has been converted to draft mode while work is in progress." without reading the PR state. The auto-resume and auto-restart paths (after a usage-limit reset) post the comment without calling `ensurePullRequestIsDraft` at all. That is why the 4 false claims appeared. The draft change is a GitHub timeline event that every reader sees, so the sentence was removed rather than made conditional.

### 3. Runtime provenance published by default

Issue #2247 (H1) added `_Runtime: …_` to every session comment to show which code ran. That is useful for debugging, but the log already records it. `shouldPublishSessionRuntime(argv)` now returns true only for `--verbose`. The line is still always logged.

### 4. "Ready to merge" posted before anything was checked

`--auto-merge` on a fork, or without merge permission, posted "## ✅ Ready to merge … This pull request is ready to be merged" before CI, conflicts or the diff were looked at. Its dedup signature was also "Ready to merge", so the **real** readiness comment was later suppressed as a duplicate.

It is now "## ⚠️ Auto-merge blocked" and says only what is known. It also has its own dedup signature. The held-back comment in `solve.auto-merge-attempt.lib.mjs` got a heading-specific signature too, so neither comment can hide the other.

### 5. Footers that repeat the heading

Several comments ended with an italic line that restated the heading:

- auto-restart: "Auto-restart-until-mergeable mode is active. This run will stop after N restart iteration(s) in total."
- restart limit: "This run is reported as failed because the auto-restart limit was reached."
- ready to merge: "Monitored by hive-mind with --auto-restart-until-mergeable flag"
- auto-merged: "Auto-merged by hive-mind with --auto-merge flag"
- usage limit: "This session was interrupted due to usage limits…"
- force-kill: "This is an automated notification…"

The `N/M` label in each heading already shows the restart budget, so these footers were removed. The comments are now built by small exported builders (`buildAutoRestartComment`, `buildUncommittedChangesRestartComment`, `buildAutoRestartLimitComment`, `buildUsageLimitSummary`) that are shared by every caller.

### 6. "Logs have been attached for debugging"

With `--auto-close-pull-request-on-fail`, three code paths closed the PR with this sentence. It was posted **before**, and independently of, the log upload, which may be disabled or may fail. The sentence was removed.

### 7. Usage limit said three times

The usage-limit comment had:

- a heading,
- a "Limit Type: Usage limit exceeded" line,
- a "How to Continue" section,
- a footer that repeated the "How to Continue" section.

The waiting comment said "The AI tool has reached its usage limit. auto-resume is enabled." and then said it again in the next paragraph. Each fact is now stated once.

While checking this message, a real bug was found. With only `--auto-restart-on-limit-reset`, `solve.mjs` exited as failed at the `shouldSkipFailureExitForAutoLimitContinue` check, right after posting "Waiting to Restart". The restart handler at the bottom of the file was never reached. The check now covers both modes.

### 8. Empty diff described as work done or as draft state

The empty-diff notice claimed the PR "stays a draft" (not checked) and that "Nothing was implemented, committed or pushed during this working session". Only the net diff was measured, not the session history. The notice now says what was measured.

For the same case, the PR description said "This pull request implements a solution for #N". It now says "It has no changes yet." when `changeStats.hasChanges` is false.

### 9. Force-kill notice promised a resume that did not happen

"Session will be resumed with `--resume` (context preserved)" was shown even when there was no session id, for example after a startup timeout. In that case the retry starts fresh. The text now follows the `resume` decision the caller already made.

### 10. Issue log upload assumed to succeed

In the issue-comment path of `solve.results.lib.mjs`, the log said the solution draft log was attached, and the function returned success without checking. The upload result is now used for both the log line and the return value.

### 11. A guessed cause for an unclassified failure

The fallback "What you can do" section of the pre-PR failure comment suggested account or permission problems for any unknown reason, including "Auto-restart limit reached". It now says to check the reason and the log.

## Audited and kept

| Message                                                        | Why it stays                                                                                                                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Now working session is ended…" footer of the log comment      | It is `NOW_WORKING_SESSION_IS_ENDED_MARKER`, used to detect user feedback after a session. Removing it would break feedback detection. It is posted only at the end of an AI session, so it is true |
| "Ended at X. Comments after this one are treated as feedback." | True when posted, and it tells the user what to do. Shortened                                                                                                                                       |
| "likely out of memory" for exit 137                            | Already hedged; exit 137 is SIGKILL, and the OOM killer is the common cause                                                                                                                         |
| Manual resume command in the usage-limit comment               | Shown only when auto-resume is off, which is exactly when the user has to run it                                                                                                                    |
| Markers such as `Auto-restart`, `Ready to merge`               | Unchanged: they are used to detect tool-generated comments                                                                                                                                          |
| The work-in-progress PR body after a failed run                | It is replaced on success. Replacing it on failure needs the failure comment's data in the PR body, a larger change, left as a follow-up                                                            |

## External issues

None were filed. Every audited message is built in this repository, and GitHub recorded the draft changes correctly. The 4 false claims have no matching `convert_to_draft` event because no conversion happened.

## Research

- **GitHub already records draft changes.** The timeline API returns `convert_to_draft` and `ready_for_review` events ([GitHub docs: issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types), [timeline events](https://docs.github.com/en/rest/issues/timeline)). The PR page shows them inline, so a comment that repeats them adds nothing.
- **Message quality.** Nielsen Norman Group's guidelines ask messages to be precise, concise and constructive, and to explain what happened and what to do next ([NN/g: error message guidelines](https://www.nngroup.com/videos/error-message-communication-guidelines/), [efficient error messages](https://www.nngroup.com/videos/efficient-error-messages/)). The changed messages follow that order: what happened, then what happens next or what to do.
- **Tense.** Google's developer style guide uses present tense for general behavior, and future or past tense only for a specific point in time ([Google: present tense](https://developers.google.com/style/tense)). A comment about an event that already happened at a stated time uses the past tense, and one about the reset uses "will".
- **Comment volume in bots.** Codecov offers `behavior: default|once|new` and `require_changes` so that it comments only when something changed ([Codecov PR comments](https://docs.codecov.com/docs/pull-request-comments)). [marocchino/sticky-pull-request-comment](https://github.com/marocchino/sticky-pull-request-comment) updates one comment instead of adding new ones. hive-mind already deduplicates with signatures (`checkForExistingComment`). This case study keeps one comment per event and makes each one shorter. A sticky status comment is a possible next step, but it would change the marker-based feedback detection, so it is not part of this fix.

## Verification

- `node tests/issue-2492-concise-truthful-messages.test.mjs` checks:
  - every session comment type: past tense, no draft claim, no runtime line unless `--verbose`, at most 160 characters
  - all new builders
  - the dedup signatures
  - the restart-only usage-limit condition
  - that the removed phrases are gone from the sources
- `tests/test-issue-2148-auto-resume-reporting.mjs`, `tests/test-activity-timeout-1510.mjs` and `tests/test-solution-summary.mjs` were updated to the new texts.
