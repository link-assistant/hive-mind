# Claude terminal errors masked by an earlier tool failure

Issue: [#2687](https://github.com/link-assistant/hive-mind/issues/2687). Implementation: [PR #2690](https://github.com/link-assistant/hive-mind/pull/2690). Evidence retrieved on 2026-10-08 UTC.

The reported run had two failures. Its last Bash command ended with exit 127 because the runtime lacked `file`. Claude then hit its account's five-hour usage limit. The terminal result explicitly reported that limit, but Hive Mind replaced it with the earlier shell diagnostic. That hid the reset time and bypassed usage-limit recovery.

The fix preserves the terminal provider error, handles result records identically with and without a final newline, and installs `file` in every independently defined Hive Mind runtime image. Genuine failed final verification still makes an otherwise successful run fail.

## Requirements and delivery

| Issue requirement                                                                 | Evidence, solution, and verification                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download all related logs and data into this case-study directory                 | All three available Gist exports, issue and PR discussions, the related attachment, primary-source snapshots, and regression output are in [data/](data/). [Evidence inventory](evidence.md) records provenance, checksums, and unavailable originals.                                   |
| Reconstruct the sequence of events                                                | The UTC timeline below distinguishes the morning killed session, evening usage-limit incident, and initial unsuccessful attempt on this PR.                                                                                                                                              |
| Identify each problem's actual root cause                                         | Missing executable, incorrect result-success interpretation, error-precedence overwrite, and incomplete trailing-record handling are traced below. The morning OOM evidence is kept separate, with explicit limits.                                                                      |
| Research additional facts and existing components                                 | [Research notes](research.md) compare the official SDK contract, Bash exit semantics, Box installation, and recent related PRs. Existing usage-limit, retry, cost, and turn-tracking components are reused.                                                                              |
| Add diagnostics when evidence is insufficient                                     | `--verbose` now records terminal subtype, error flag, provider error code, and HTTP status for both stream framings. Existing resource/cgroup/process diagnostics remain available for a future killed-session investigation.                                                            |
| Report relevant upstream problems with reproduction, workaround, and proposed fix | [Box #129](https://github.com/link-foundation/box/issues/129) documents the attachment prerequisite, finite reproduction command, verified Homebrew workaround, and proposed essentials/image-test changes. SDK error semantics are already documented and discussed upstream.           |
| Apply the fix throughout the codebase                                             | Both Claude result-parsing paths share a handler; background-turn recovery rejects error results; terminal tool precedence and transient retry gates respect terminal errors. All three runtime Dockerfiles install the prerequisite; derived images inherit it.                         |
| Verify the bug before fixing it and deliver in one PR                             | The command-wrapper replay initially failed seven of ten tests. Two additional tests then reproduced stale transient flags. All 18 regression tests pass after the fix. The patch changeset, regression, runtime checks, experiments, and case study are delivered together in PR #2690. |

## UTC timeline

All incident times below are on 2026-10-07 unless stated otherwise. Raw line references refer to the archived files, not the GitHub comment rendering.

| Time                | Event                                                                                                                                        | Source                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 07:18:10            | An earlier Agent attempt on PR #2592 reports a missing `/tmp/.../e.g` file. Its log upload failed with HTTP 403.                             | [PR discussion snapshot](data/pr-2592-comments.json), comment 6032993852                                       |
| 09:09:24            | A Claude Opus session starts on PR #2592 using Hive Mind 2.33.11.                                                                            | Same discussion, comment 6034740738                                                                            |
| 09:09:57            | The morning session also encounters `file: command not found`, but subsequent shell commands leave the enclosing tool result successful.     | [Morning log](data/claude-oom.log), lines 1455–1465                                                            |
| 09:41:07–09:41:08   | The Claude process is killed; the wrapper reports exit 137.                                                                                  | Morning log, lines 41893–41897                                                                                 |
| 09:41:14            | The wrapper lists 105 processes still running in the task directory, including tests and CLI version probes.                                 | Morning log, line 41918 onward                                                                                 |
| 09:42:46            | PR #2592 publishes the failure and the first morning Gist.                                                                                   | PR discussion, comment 6035301295                                                                              |
| 09:54:21–09:54:23   | The session monitor publishes an intermediate log, records `OOMKilled: true`, and announces continuation of the same task.                   | [Killed-session export](data/claude-killed-session.log), lines 42188–42198; comments 6035478435 and 6035478778 |
| 21:22:05            | The user asks PR #2592 to continue delivering its original task.                                                                             | PR discussion, comment 6047109579                                                                              |
| 21:23:03            | A new Claude run starts using Hive Mind 2.34.0.                                                                                              | [Evening log](data/claude-exit-127.log), line 219; comment 6047124122                                          |
| 21:23:29–21:23:32   | Claude downloads the issue attachment and runs `file` after Git commands. Bash exits 127 because `file` is absent.                           | Evening log, lines 1323–1409                                                                                   |
| 21:23:32.896        | The next Anthropic request returns HTTP 429. Headers identify a rejected five-hour window, utilization 1.0, and reset epoch 1791411600.      | Evening log, lines 1485–1511                                                                                   |
| 21:23:33.116        | A structured rate-limit event identifies `five_hour` and the same reset epoch.                                                               | Evening log, lines 1524–1545                                                                                   |
| 21:23:33.122        | A synthetic assistant error reports the session limit and 10:20pm UTC reset.                                                                 | Evening log, lines 1581–1593                                                                                   |
| 21:23:33.129        | The terminal result has `subtype: success`, `is_error: true`, `api_error: usage_limit_reached`, HTTP 429, and cost $0.2582846.               | Evening log, lines 1687–1699                                                                                   |
| 21:23:33.475        | Hive Mind overwrites the terminal error with `Final tool result failed: Exit code 127` and the preceding Git output.                         | Evening log, lines 1709–1718                                                                                   |
| 21:23:39            | The overwritten diagnostic appears in the public failure comment.                                                                            | [Reported failure](https://github.com/link-assistant/hive-mind/pull/2592#issuecomment-6047133066)              |
| 21:46:45            | Issue #2687 is opened with the evening incident and investigation requirements.                                                              | [Issue snapshot](data/issue.json)                                                                              |
| 21:56:54            | The initial attempt on PR #2690 fails under Agent with another missing `e.g` path; its full log also cannot be uploaded because of HTTP 403. | [PR #2690 discussion](data/pr-2690-comments.json), comment 6047658804                                          |
| 2026-10-08 01:55:05 | A Codex continuation begins this investigation.                                                                                              | Same discussion, comment 6050570663                                                                            |

Epoch 1791411600 corresponds to 2026-10-07 22:20:00 UTC, agreeing with the rendered reset time. The account limit is independent of the missing executable: installing `file` cannot replenish the account's quota.

## Root causes and changes

### 1. The runtime was missing an attachment-validation prerequisite

The failed Bash tool record contains both ordinary `git log` output and `/bin/bash: line 1: file: command not found`. Exit 127 came from the final `file` invocation, not from the displayed commits. The current investigation environment reproduced the missing executable with [check-file.sh](../../../experiments/issue-2687/check-file.sh). Its [before](data/file-before.log) and [after](data/file-after.log) captures show the prerequisite becoming available and recognizing the downloaded PNG.

Hive Mind inherits its development tools from Box. The inspected Box essentials installer did not explicitly include `file`. The standard, DinD, and Coolify runtime definitions now conditionally install it with Homebrew as the existing `box` user. This works without sudo; a local sudo attempt required a password, whereas the Homebrew installation succeeded. `Dockerfile.e2e` and `Dockerfile.formal-ai` derive from Hive Mind runtime images and inherit the prerequisite.

`scripts/verify-docker-image.sh` now requires `file --version`. This turns a missing prerequisite into an image-verification failure. [Box #129](https://github.com/link-foundation/box/issues/129) proposes moving the dependency into the common base and verifying MIME identification there too. A clean historical base-image reproduction was suggested upstream; it was not performed locally.

### 2. `subtype: success` was mistaken for an error-free session

Claude's result subtype describes completion of the agent loop. The independent `is_error` flag can still be true after a final API error. The official SDK contract and Python error implementation confirm this combination; see [research notes](research.md).

`executeClaudeCommand` formerly set `resultSuccessReceived` from the subtype alone, attached the provider failure as a solution summary, and recorded the error simultaneously. A later guard added for failed verification in #2263 saw the success flag and unconditionally replaced the terminal error with the last failed tool record.

The shared result handler now considers success only when `subtype === 'success' && is_error !== true`. It retains costs even on failures, while capturing a solution summary and success model metadata only for a real success. The final-tool guard runs only when there is no existing command/execution failure and the native exit status is zero. Native nonzero process exits are also recorded as command failures when the process result supplies the exit status rather than a stream chunk. Existing forced-close handling is retained.

This preserves the #2263 verification rule: a diagnostic-rich failed final compiler/test command still overrides an actual error-free success result. Exploratory failures followed by later successful tool results and existing benign self-handled failures retain their behavior.

### 3. A final record without a newline bypassed error handling

The normal NDJSON path processed provider errors, while the remaining-buffer path only captured cost and success metadata. A CLI ending immediately after its JSON result could therefore lose its usage-limit or other error classification. Arbitrary stdout chunk boundaries make this a protocol issue rather than an unusual line-format preference.

Both paths now call the same result handler. Tests cover a final newline, no final newline, and a split unterminated result. Subscription detection, ENOSPC handling, timeout/429 detection, cost capture, idle feedback, and verbose diagnostics are consequently shared rather than independently reimplemented.

### 4. Usage-limit recognition and recovery precedence were incomplete

The result-specific limit check recognized only older English wording even though `isUsageLimitError` already recognized the actual incident's message. The handler now uses that existing component and accepts the structured `usage_limit_reached` code without depending on English text.

An account limit must also take precedence over transient flags left by earlier stream events. A separate replay demonstrated that an earlier HTTP 500 could otherwise retry despite the final usage limit. The transient gate now rejects a known account limit. A genuinely temporary HTTP 429 still retries and resumes successfully.

`assessClaudeTurnCompletion` also formerly accepted a subtype-only success. It now excludes error results before identifying an unfinished background-task turn, preventing a provider failure from being treated as a successful turn that merely needs automatic continuation.

### 5. The morning kill and the earlier Agent failures have different evidence limits

The morning export establishes a killed process, exit 137, high load, and a later monitor report that the container was OOM-killed. It does not include the kernel victim trace or per-process peak memory, so it cannot identify the exact allocation or process responsible. The evening incident has zero cgroup OOM events/kills in its resource records and a complete provider-error sequence; attributing that incident to memory would contradict the trace.

Existing resource snapshots, cgroup limits/counters, remaining-process diagnostics, and staggered killed-session recovery already cover this separate class of event. For a future recurrence, preserve container inspection, cgroup `memory.events`/`memory.peak`, and the host kernel OOM report when accessible, alongside the original process log. No unbounded memory or stack stress was used in this investigation.

The two Agent `e.g` failures have only summary comments because their log uploads failed. Neither referenced original path exists in this workspace. Their internal cause cannot be established from this evidence, and this PR does not invent a diagnosis for them. [Evidence inventory](evidence.md) records those missing artifacts explicitly.

## Reproduction and validation

Run the hermetic command-wrapper regression without a provider account:

```bash
node tests/claude-result-error-precedence-2687.test.mjs
```

It replays the failed Bash tool followed by the captured terminal result through the real `executeClaudeCommand` entry point with mocked process output. Account-limit tests assert the original message, reset time, timezone, billing cost, absence of a false solution summary, and exactly one attempt. Other cases exercise provider HTTP 400 errors, machine-readable limits, earlier transient flags, genuine temporary HTTP 429 retries, ENOSPC, native nonzero exits, missing-CLI installation guidance, failed final verification, and background-turn completion.

The initial reproduction produced **7 failures / 3 passes** in [regression-before.log](data/regression-before.log). The later stale-flag reproduction produced **2 failures / 15 passes** in [stale-retry-before.log](data/stale-retry-before.log). The final suite produces **18 passes / 0 failures** in [regression-after.log](data/regression-after.log). Each asynchronous test has a finite ten-second test deadline; test retry delays and attempt counts are bounded.

The dependency reproduction is reusable:

```bash
bash experiments/issue-2687/check-file.sh
```

The log-indexing experiment uses streaming reads and batches of at most 1500 lines. The recorded invocation used a 128 MB Node heap cap and the three finite archived files:

```bash
node --max-old-space-size=128 experiments/issue-2687/summarize-logs.mjs \
  docs/case-studies/issue-2687/data/claude-exit-127.log \
  docs/case-studies/issue-2687/data/claude-oom.log \
  docs/case-studies/issue-2687/data/claude-killed-session.log
```

The source screenshot is incident evidence, not a changed UI. Its downloaded bytes were confirmed to be a PNG with `file` before visual inspection. No frontend behavior is modified.

## Release and CI

A patch Changeset prepares the user-visible fix for the repository's existing release process; the published package version is not manually changed.

The initial non-passing status was a Security run with conclusion `action_required`, no jobs, and no downloadable log. It was not evidence of a failed test: [initial run metadata](data/initial-security-run.json) and [log-fetch result](data/initial-security-log-fetch.log) preserve that distinction. Final validation uses runs created after the implementation commit and matching the PR head SHA; local and remote results are listed in the updated PR description.
