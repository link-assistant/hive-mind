# Issue 2023 Case Study: Missing Claude Result Should Auto-Resume

## Scope

Issue [#2023](https://github.com/link-assistant/hive-mind/issues/2023) reports a failed solver run ending with:

```text
Command failed: Claude stream ended without a terminal result event after: Exit code 144
```

The issue asks for automatic resume instead of a hard failure, plus a case-study archive under `docs/case-studies/issue-2023/`.

Evidence archived here:

- `raw-data/start-command-log.txt`: full `start-command` log from the original failed container run.
- `raw-data/claude-failure-log.txt`: failure log uploaded by the solver after the Claude command aborted.
- `raw-data/issue-2023.json`: issue metadata captured from GitHub.
- `raw-data/pr-2024.json`: prepared PR metadata.
- `raw-data/issue2023-test-before.log`: focused regression test before the fix.
- `raw-data/issue2023-test-after.log`: focused regression test after the fix.
- `raw-data/npm-ci.log`: local dependency install log.

## Timeline

- 2026-07-09 01:07:44 UTC: Claude emitted a failed tool result with `Exit code 144` (`raw-data/start-command-log.txt:36624`, `raw-data/start-command-log.txt:36636`).
- 2026-07-09 01:08:04 UTC: a second tool result again reported `Exit code 144` (`raw-data/start-command-log.txt:37129`, `raw-data/start-command-log.txt:37141`).
- 2026-07-09 01:08:05 UTC: the wrapper detected that the stream closed without a terminal `result` event and built the failure message (`raw-data/start-command-log.txt:37207`).
- 2026-07-09 01:08:05 UTC: the wrapper printed both interactive and autonomous `claude --resume 6e01ef90-...` commands, proving it had a resumable session id (`raw-data/start-command-log.txt:37215`, `raw-data/start-command-log.txt:37217`).
- 2026-07-09 01:08:17 UTC: the wrapper uploaded the failure log to the target PR as a public gist comment (`raw-data/start-command-log.txt:37265`).
- 2026-07-09 01:08:20 UTC: critical-error recovery auto-committed and pushed target-repo work, then exited with `CLAUDE execution failed...` instead of continuing the session (`raw-data/start-command-log.txt:37280`, `raw-data/start-command-log.txt:37292`, `raw-data/start-command-log.txt:37312`).

## Requirements

| #   | Requirement                                                                                         | Status                                                  |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| R1  | Auto-resume after `Claude stream ended without a terminal result event after: Exit code 144`.       | Done                                                    |
| R2  | Preserve the same Claude context with `--resume <sessionId>`.                                       | Done                                                    |
| R3  | Download all available logs and issue/PR data to `docs/case-studies/issue-2023/`.                   | Done                                                    |
| R4  | Reconstruct timeline, requirements, root cause, solution options, and related components/libraries. | Done                                                    |
| R5  | Add debug output if existing logs are insufficient.                                                 | Not needed; verbose logs contained the decisive events. |
| R6  | Report upstream if there is a clear external-project bug with a reproducible example.               | Not filed; see "Upstream search".                       |
| R7  | Add a reproducing automated test before implementing the fix.                                       | Done (`raw-data/issue2023-test-before.log`).            |

## Root Cause

The missing-result detector was introduced by issue #1974 to prevent false success when Claude stream-json exits without a terminal `result` event. That detector worked: it converted the incomplete stream into this failure message:

```text
Claude stream ended without a terminal result event after: Exit code 144
```

However, `src/claude.lib.mjs` made its transient-retry decision before this message was built. At classification time, `lastMessage` was still only `Exit code 144`, which was not retryable. The missing-result message was created later, after the unified retry block had already been skipped, so execution fell through to the generic command-failed path.

`src/tool-retry.lib.mjs` also had no classifier branch for the missing-terminal-result message. Even if the ordering were corrected, the message still would not have entered the existing retry block.

## Solution Options

1. **Chosen: classify missing terminal result as retryable and build the message before retry classification.**
   This uses the existing transient retry path, including exponential backoff, `--resume <sessionId>`, fallback-model behavior, and retry caps.
2. Retry every `Exit code 144`.
   Rejected because exit 144 can represent a Bash/background-task termination. It is too broad without the missing-result context.
3. Treat every missing terminal result as a hard failure but auto-start a new `solve --resume` process outside `executeClaudeCommand`.
   Rejected because the lower-level retry block already has the session id and retry policy; doing it outside would duplicate recovery logic.

## Implemented Fix

`src/tool-retry.lib.mjs` now classifies:

```text
Claude stream ended without a terminal result event...
```

as `isRetryable: true`, `isCapacity: false`, with the label `Claude stream ended without terminal result`.

`src/claude.lib.mjs` now calls `shouldFailClaudeStreamWithoutResult()` before `classifyRetryableError(lastMessage)`. When a session id exists and this failure occurs, the existing retry block sets `argv.resume = sessionId`, waits according to the transient retry backoff, and invokes Claude again with `--resume`.

## Regression Test

`tests/test-issue-2023-claude-missing-result-resume.mjs` covers both parts:

- the exact message `Claude stream ended without a terminal result event after: Exit code 144` is classified as retryable and non-capacity;
- a fake first Claude stream emits a session id plus a failed tool result, ends without `result`, and the second invocation must include `--resume session-2023`.

Before the fix, both assertions failed (`raw-data/issue2023-test-before.log`):

```text
false !== true
```

After the fix, both pass (`raw-data/issue2023-test-after.log`).

## Upstream Search

Searches for the exact generated message found no matching `anthropics/claude-code` issue. The exact string is produced by hive-mind, so it is not directly reportable upstream.

Related public data does show that `Exit code 144` is a real Claude Code/Bash-tool family of failures, especially around background task termination:

- [`anthropics/claude-code#62297`](https://github.com/anthropics/claude-code/issues/62297) reports background Bash cleanup being summarized as failed with exit code 144 and asks Claude Code to distinguish expected termination from arbitrary non-zero failure.
- [`anthropics/claude-code#45717`](https://github.com/anthropics/claude-code/issues/45717) discusses Bash timeout / SIGTERM behavior surfacing as exit code 144.

Related orchestration docs also support treating stream-json terminal events as authoritative and treating empty or incomplete output as a diagnostic failure instead of success. [RondoFlow's Claude Code provider documentation](https://docs.rondoflow.app/providers/claude-code/) says its spawner parses stream-json events, treats `result.is_error` as authoritative, and reports empty-output runs for diagnosis.

No new upstream issue was filed because this PR fixes a hive-mind recovery gap, and the available data does not contain a minimal raw-Claude reproduction where Claude Code itself omits a terminal result event. If this recurs outside hive-mind with a small `claude --output-format stream-json` reproduction, that should be reported upstream with the raw stream, CLI version, session id handling, and the successful manual `--resume` workaround.

## Verification

Local dependency setup completed with:

- `node scripts/npm-install-with-retry.mjs ci` (`raw-data/npm-ci.log`)

Focused verification passed:

- `node tests/test-issue-2023-claude-missing-result-resume.mjs` (`checks/focused-regression.log`)
- `node tests/test-issue-1974-claude-stream-completion.mjs` (`checks/issue-1974-regression.log`)
- `node tests/test-issue-1937-stream-idle-timeout-retry.mjs` (`checks/issue-1937-regression.log`)
- `npm run lint` (`checks/npm-lint.log`)
- `npm run format:check` (`checks/npm-format-check.log`)
- `git diff --check` (`checks/git-diff-check.log`)
- `bash scripts/check-file-line-limits.sh` (`checks/file-line-limits-final.log`)

`npm test` was also run (`checks/npm-test.log`). It stopped at `tests/test-issue-1209-overrides.mjs` when the first subtest timed out after 12 seconds in this local Node 20.20.2 environment (`checks/node-npm-version.log`). The failing file was rerun by itself and all 11 cases passed (`checks/issue-1209-overrides-rerun.log`).
