# Case study: issue #2397 — three failure comments for one failure

- Issue: https://github.com/link-assistant/hive-mind/issues/2397
- Pull request: https://github.com/link-assistant/hive-mind/pull/2398
- Affected run: https://github.com/konard/vietnam-accomodation-search/pull/76

## Summary

A ChatGPT Pro subscription ran out while Hive Mind was continuing pull request #76 of
`konard/vietnam-accomodation-search` with `--tool codex --model gpt-6.1-sol`. Codex
answered every request with

```text
The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.
```

The solver then posted **three** "🚨 Solution Draft Failed" comments within five seconds.
None of them said the plan had to be renewed. Two of them said the 5 MB log could not be
uploaded because "Credential sanitization failed; publication was blocked." Nothing
showed which check had blocked it.

Six separate defects were involved. Each one is fixed in PR #2398 and covered by a test
that failed before its fix.

| #    | Problem                                                                           | Fix                                                         | Test                                                         |
| ---- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| RC1  | The exit handler re-reported a failure that the failure path had already reported | Per-target record of the latest tool comment                | `tests/issue-2397-single-failure-comment.test.mjs`           |
| RC2  | The exit handler posted its own fallback on top of the "Log Upload Failed" report | Skip the fallback when the upload already reported it       | same                                                         |
| RC2b | A stop or limit-reached comment was followed by a redundant failure comment       | Stop and limit-reached comments count as the failure report | same                                                         |
| RC3  | The Codex plan rejection was not recognised                                       | Classified as `PLAN_RESTRICTED`, with renewal guidance      | `tests/issue-2397-codex-plan-restricted.test.mjs`            |
| RC4  | Any log containing `token => …` could not be published                            | Separator fix plus a fixed-point sanitizer                  | `tests/issue-2397-sanitizer-idempotency.test.mjs`            |
| RC4b | The known-token verifier blocked values that the maskers never masked             | One shared minimum length; logs mask env tokens             | `tests/issue-2397-known-token-consistency.test.mjs`          |
| D1   | A blocked publication gave no reason                                              | Stage, rule ids and log block position in the reason        | `tests/issue-2397-sanitization-failure-diagnostics.test.mjs` |

## Data collected

All files are in [`data/`](./data). Commit author emails in `pr-76.json` were replaced
with `[redacted]`.

| File                                                              | Content                                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `issue.json`                                                      | Issue #2397                                                                      |
| `pr-76.json`, `pr-76-comments.json`, `pr-76-review-comments.json` | The affected pull request, its commits and all its comments                      |
| `test-hello-world-fa49-pr-2-comments.json`                        | `konard/test-hello-world-019fb330-fa49-…#2`, a long-running test PR              |
| `test-hello-world-00e1-pr-2-comments.json`                        | A second long-running test PR                                                    |
| `audio-decomposer-pr-5-comments.json`                             | A failed run that reported correctly, used as a reference                        |
| `openai-codex-49396.json`                                         | openai/codex#49396 with all comments                                             |
| `openai-codex-related-issues.json`                                | openai/codex issues with "not supported when using Codex with a ChatGPT account" |

The solver log of the affected run was never published. It is still on the machine that
ran the session (`/home/box/solve-2026-09-30T14-55-22-906Z.log`, 5 MB). That machine is not
reachable from here, so RC4 and RC4b are reconstructed from the code rather than read
from the log. See "Remaining uncertainty".

## Timeline (UTC)

| Time                | Event                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-09-30 14:55:22 | Solver session starts; the log file is named after this time                                                          |
| 14:56:16            | "Initial commit with task details" on the PR branch                                                                   |
| 14:56:26            | Draft PR #76 opened                                                                                                   |
| 15:38:42 – 15:40:10 | Codex pushes five work commits                                                                                        |
| 15:56:45            | Last work commit "fix: exclude private communities from public audit acceptance"                                      |
| ≈15:57              | The ChatGPT Pro period has ended; Codex returns HTTP 400 `invalid_request_error` for `gpt-6.1-sol`                    |
| 15:57:18            | Comment 5914889717: "Solution Draft Failed" + "Log Upload Failed" (posted by `attachLogToGitHub` in the failure path) |
| 15:57:22            | Comment 5914891008: the same report again (posted by `attachLogToGitHub`, called by the exit-handler notifier)        |
| 15:57:23            | Comment 5914891253: a third report (the notifier's own fallback, "Log attachment was attempted but failed")           |
| 2026-10-01 13:34:38 | Issue #2397 opened                                                                                                    |

## Requirements from the issue

| #   | Requirement                                                                | Where addressed                                              |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| R1  | Post a single failure comment, not three                                   | RC1, RC2, RC2b                                               |
| R2  | The single comment must give a clear reason                                | RC3                                                          |
| R3  | Check how other merged and failed PRs behave                               | "Comparison with other pull requests"                        |
| R4  | Fix all root causes that prevented the log upload                          | RC4, RC4b, plus D1 for causes the available data cannot show |
| R5  | Collect the data in `docs/case-studies/issue-2397`                         | `data/`                                                      |
| R6  | Deep case study: timeline, requirements, root causes, solutions, libraries | this document                                                |
| R7  | Search online for additional facts                                         | "Upstream: openai/codex"                                     |
| R8  | Add debug output where the data is insufficient                            | D1                                                           |
| R9  | Report issues to other projects, with repro, workaround and fix suggestion | "Upstream: openai/codex"                                     |
| R10 | Apply each fix everywhere the same problem exists                          | "Same problem elsewhere"                                     |

## Root causes

### RC1 — the exit handler did not know the failure was already reported

`attachLogToGitHub` (`src/github.lib.mjs`) posts the whole failure report itself when an
upload fails. That report is "🚨 Solution Draft Failed" with a "⚠️ Log Upload Failed"
section, and the function then **returns `false`**. The failure path treats `false` as
"nothing was posted", so it never sets `pullRequestFailureNotificationPosted`.

The process then exits with code 1. The exit-handler notifier
(`notifyIssueAboutPrePullRequestFailure`, wired in `src/solve.mjs`) sees the unset flag and
reports the failure again. Comment 5914891008 is that second report: it has the same "Log
Upload Failed" section, because the notifier also calls `attachLogToGitHub` and the
upload fails again for the same reason.

**Fix.** Every comment goes through `postTrackedComment` (`src/tool-comments.lib.mjs`). It
now records the latest tool comment for each owner/repo/number and whether that comment
is a failure report. `resolvePreExitFailureNotificationTarget` returns no target when the
pull request's latest tool comment is already a failure report.

The check is "the latest comment", not "any comment". If an auto-restart posts
"🔄 Auto-restart" after a failure, a later failure is still reported, and a test pins
this.

### RC2 — the notifier's fallback stacked on top of the upload's report

When `attachLogToGitHub` returned `false`, the notifier continued to its plain-text
fallback ("Log attachment was attempted but failed …"). That produced comment
5914891253, the third one.

**Fix.** After a failed attach, the notifier asks whether the target now carries a failure
report. If it does, it stops there and returns `{ notified: true, method: 'log-upload-failure-report' }`.
The fallback still runs when the upload failed without posting anything, for example
when `attachLogToGitHub` throws first. Tests cover both cases.

### RC2b — "Automation stopped" and "limit reached" were followed by a redundant failure

This is the same pattern under a different first comment. It came up while checking
other pull requests (R3):

| PR                                   | First comment                                                        | Then, seconds later                                                     |
| ------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| test-hello-world-fa49 #2, 2026-08-08 | `❌ Auto-restart 5/5 - limit reached` (15:46:07)                     | `🚨 Solution Draft Failed … Reason: Auto-restart limit reached` (8 s)   |
| test-hello-world-fa49 #2, 2026-08-15 | `❌ Auto-restart 5/5 - limit reached` (07:39:16)                     | `🚨 Solution Draft Failed` (9 s)                                        |
| test-hello-world-fa49 #2, 2026-09-16 | `🛑 Automation stopped …` (09:48:58), `✅ Ready to merge` (09:51:16) | `🚨 Solution Draft Failed … Reason: No progress between sessions` (7 s) |
| test-hello-world-fa49 #2, 2026-09-27 | `🛑 Automation stopped …` (15:06:30)                                 | `🚨 Solution Draft Failed … Reason: No progress between sessions` (7 s) |
| test-hello-world-00e1 #2, 2026-08-02 | `❌ Auto-restart 5/5 - limit reached` (14:22:46)                     | `🚨 Solution Draft Failed` (13 s)                                       |
| test-hello-world-00e1 #2, 2026-08-13 | `❌ Auto-restart 5/5 - limit reached` (18:28:26)                     | `🚨 Solution Draft Failed` (14 s)                                       |

**Fix.** `isFailureReportCommentBody` also recognises the "🛑 Automation stopped" and
"❌ Auto-restart N/N - limit reached" templates. Those two comments end the automation:
nothing restarts after them. They therefore stay the run's failure report even when a
later comment such as "✅ Ready to merge" follows, as in the 2026-09-16 row.

When the notifier skips, it logs `Failure already reported on pull request #N by an earlier tool comment; not posting another.`

### RC3 — a lapsed plan was reported as a generic tool failure

`src/subscription-error.lib.mjs` had no rule for Codex's
`The '<model>' model is not supported when using Codex with a ChatGPT account.` So the
comment showed only `CODEX execution failed with …`, followed by generic advice about
"repository, account, permissions, or environment".

**Fix.** A codex `PLAN_RESTRICTED` rule now matches this message. The summary reads
"CODEX stopped: Current plan does not allow this request …". The guidance gives these
steps:

- Renew or check the plan at https://chatgpt.com/codex/settings/usage.
- Choose a model the plan includes with `--model`.
- Run `codex login` again.
- If the plan is active, update the app-server daemon with `codex app-server daemon update`.

The last step exists because an active plan gets the same 400 from a stale daemon;
see the upstream section below.

### RC4 — any log containing `token => …` was blocked

`sanitizeForPublication` is fail-closed: after masking, it treats the text as unsafe if a
second masking pass would still change it (`findCredentialResiduals`). The core sanitizer
(`src/credential-sanitization-core.lib.mjs`) was not idempotent for a short value after
`=>`:

```text
pass 1: const f = token => !token;   ->  const f = token => [REDACTED];
pass 2: const f = token => [REDACTED];  ->  const f = token =[REDACTED] [REDACTED];
```

On the second pass the assignment separator `[:=]` backtracked from `=>` to `=`, so
`> [REDACTED]` became the "value". Any log containing an arrow function whose parameter is
named `token`, `secret`, `password` or `api_key` was blocked with "Residual credential
material detected", and so was Ruby or PHP `'password' => '…'`. Codex streams the files it
reads into the solver log, so this is common: a scan of the installed `node_modules`
found 23 of 8492 JavaScript files that the publication boundary rejected
(`experiments/issue-2397-scan-js-corpus.mjs`). One file in this repository's own `src/`
was rejected too.

**Fix.** There are two parts:

- `=` and `:` are no longer separators when followed by `>`. `=>` is its own separator.
- `sanitizeCredentialText` runs to a fixed point, with at most 3 passes. A future
  non-idempotent rule can then no longer block publication by itself.

`experiments/issue-2397-fixed-point-only.mjs` shows that the fixed-point loop alone
already unblocks the reproducer. `experiments/issue-2397-fuzz-idempotency.mjs` fuzzes the
property.

### RC4b — the verifier blocked what the maskers left alone

The last residual check, `containsKnownToken`, looks for every value in
`KNOWN_LOCAL_TOKEN_ENV_VARS` in the output, at any length. The maskers disagreed with it in
two ways:

- every masker skips values shorter than 12 characters;
- `sanitizeOutput`, which the log path uses, only masked GitHub CLI tokens, not the env
  tokens.

As a result:

- With `TELEGRAM_OWNER_CHAT_ID=123456789`, the chat id is not a secret and is never
  masked. Every log that mentions it, or any number that contains it (such as
  `upload size 9123456789 bytes`), was blocked with `known-token:TELEGRAM_OWNER_CHAT_ID`.
- A `GITHUB_PAT` that matches no vendor pattern was never masked in logs, so any log
  that echoed it was blocked with `known-token:GITHUB_PAT`.

Both are reproduced in `experiments/issue-2397-known-token-mismatch.mjs`.

**Fix.** `MIN_KNOWN_TOKEN_LENGTH = 12` is now shared by the maskers and the verifier, and
`sanitizeOutput` also masks the env tokens. Publication is still fail-closed for every
value that can be masked, and a value that cannot be masked no longer blocks forever.

### D1 — "publication was blocked" gave no reason

`CredentialSanitizationError` discarded its cause. "Credential sanitization failed;
publication was blocked." could therefore not tell apart:

- a crash in the primary sanitizer;
- Secretlint being unavailable;
- a residual found by the core rules, Secretlint or the known-token scan;

and it did not say where in a 5 MB log the problem was.

**Fix.** The error now carries:

- `stage`: `primary`, `residual-scan`, `secretlint`, `known-token-scan` or `residual`;
- `findings`: rule ids with counts, never the matched text;
- `blockIndex`, `blockStartChar` and `blockChars`, from the streaming sanitizer;
- all of the above across the bounded worker boundary.

`describeCredentialSanitizationFailure()` renders them into the "Last upload error" line,
for example
`Credential sanitization failed; publication was blocked. (stage: residual; findings: known-token:GITHUB_PAT×1; log block 3 starting at character 2097152, 1048576 characters)`.
The next blocked upload will therefore name its root cause in the PR comment itself.

## Comparison with other pull requests (R3)

- **Normal failures report once.** For example `audio-decomposer#5` (2026-09-05): one
  "🚨 Solution Draft Failed" with the log uploaded as a Gist. When the upload succeeds,
  `attachLogToGitHub` returns `true`, the flag is set and the notifier stays quiet. The
  three-comment pattern therefore needs a failed upload, which is why it was first seen
  on #76.
- **Stop and limit-reached runs reported twice.** These are the RC2b rows above. The bug
  was older than #76 and had been going on since at least 2026-08-02.
- **Separate sessions report separately.** For example fa49 #2 at 2026-09-27 15:05:05 and
  15:06:09: two sessions failed, each with its own log. Each failure is real. The
  "latest comment" rule keeps these reports, and a test pins that.

## Same problem elsewhere (R10)

- All tool comments, including stop, limit-reached, ready and failure comments, go
  through `postTrackedComment`, so the per-target record sees all of them. The search was
  `grep -rn "gh pr comment\|gh issue comment\|/comments" src`. The only other poster,
  `session-kill-recovery.lib.mjs`, posts a recovery notice, not a failure report.
- All credential masking for publication goes through
  `credential-sanitization-core.lib.mjs`, so the separator and fixed-point fix applies
  to:
  - comments
  - Gist and log uploads
  - Sentry payloads
  - the interactive-mode PR stream
- The known-token threshold is one constant, used by `sanitizeOutput`,
  `sanitizeCommentBody`, `maskEncodedKnownTokens` and `containsKnownToken`. That last
  function is also behind the interactive-mode leak warning.

## Upstream: openai/codex

The error text is not specific to an ended plan. openai/codex#49396 ("Codex CLI says
gpt-6.1-sol is unsupported with ChatGPT sign-in without explaining eligibility") reports
the identical 400 from **active** Pro accounts. In the comments of 2026-09-30 and
2026-10-01, users trace it to a background app-server daemon that is older than the model
(for example CLI 0.159.3 with `appServerVersion: 0.158.0`).

Workarounds reported there:

```sh
codex app-server daemon update --from-cli --yes
codex app-server daemon restart
codex app-server daemon version   # expect >= 0.159.2
# or, for one session
codex --no-daemon
```

Related issues with the same message: #17642, #32036, #42944, #46304, #47333, #47784,
#49619 and #49703 (`data/openai-codex-related-issues.json`).

Our case adds a third cause behind the same text: the plan period ended. A comment on
#49396 records this ([comment 5933238726](https://github.com/openai/codex/issues/49396#issuecomment-5933238726)) and suggests a fix in Codex:
return distinct error codes or messages for

- not entitled by plan,
- plan expired,
- model unknown to this client or daemon version, and
- rollout not reached.

It also suggests that the CLI warn when its version differs from the daemon's. A new issue
was not filed, because #49396 is the open tracking issue for exactly this message.

Until Codex distinguishes these causes, Hive Mind lists all of them in its guidance (RC3).

## Existing tools considered

- **Secretlint** (already a dependency) is used as the second scanner. It does not cover
  sanitizer idempotency, which is our own invariant.
- **gitleaks**, **TruffleHog** and **detect-secrets** are detectors, not maskers. They
  would add a third opinion, but not the guarantee that masking is stable. That guarantee
  is what the publication boundary depends on, so the fix is to make masking a fixed
  point.
- **Sticky-comment actions** (`marocchino/sticky-pull-request-comment`,
  `peter-evans/create-or-update-comment`) solve "one comment per purpose" by editing a
  marked comment. Hive Mind needs a separate comment per session for history. It
  therefore applies the same idea in memory, as a per-target "already reported" record,
  instead of editing comments.

## Remaining uncertainty

- The log of the affected run cannot be read from here, so it is not proven which
  residual blocked that upload. RC4 is the most likely cause:
  - a Codex session that reads JavaScript sources prints arrow functions;
  - about one such file in 370 was blocked in our own corpus scan.
  - RC4b applies only if the solver host has `TELEGRAM_OWNER_CHAT_ID` or a custom
    `GITHUB_PAT` set.
- Both are fixed. If an upload is still blocked, the PR comment will now name the stage,
  rule id and log block (D1), and running
  `gh-upload-log /home/box/solve-2026-09-30T14-55-22-906Z.log` on the host will show the
  same information.

## Reproducing

```sh
node experiments/issue-2397-replay-three-comments.mjs     # three comments before the fix, one after
node experiments/issue-2397-min-repro.mjs                 # 'token =>' blocked before the fix
node experiments/issue-2397-known-token-mismatch.mjs      # short env value blocked before the fix
node tests/issue-2397-single-failure-comment.test.mjs
node tests/issue-2397-codex-plan-restricted.test.mjs
node tests/issue-2397-sanitizer-idempotency.test.mjs
node tests/issue-2397-known-token-consistency.test.mjs
node tests/issue-2397-sanitization-failure-diagnostics.test.mjs
```
