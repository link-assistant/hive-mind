# Case study: issue #4079 — a 10-hour Codex turn degenerates into 63k `.` lines and ends with `max_output_tokens`

- Issue: https://github.com/link-assistant/hive-mind/issues/4079
- Pull request: https://github.com/link-assistant/hive-mind/pull/4080
- Failing run: https://github.com/link-foundation/code-quality/pull/2 (`solve --tool codex --think xhigh --attach-logs --verbose`, model `gpt-6.1-sol`, Codex CLI 0.169.0, solve v2.39.10)
- Full log (published by `--attach-logs`; 169,155 lines, 27 MB): [`solve.log`](https://github.com/link-foundation/code-quality/blob/e0e2e03d8e78fee2119e6d272ebee4aef2505682/dev/log/issues/1/pulls/2/sessions/01a1ea2a-c8cb-7382-a01f-9113c3295ca3/solve.log). It is not copied here, because it contains the account identifiers described in section 2.4.
- Experiments (each one reads the log and prints only counts and positions):
  - [`experiments/issue-4079-degenerate-replay.mjs`](../../../experiments/issue-4079-degenerate-replay.mjs): where the degenerate-output detector would have stopped the turn
  - [`experiments/issue-4079-stderr-replay.mjs`](../../../experiments/issue-4079-stderr-replay.mjs): what the new stderr filter keeps in the log
  - [`experiments/issue-4079-redaction-check.mjs`](../../../experiments/issue-4079-redaction-check.mjs): how many identity values the log redaction replaces
- Regression tests:
  - [`tests/codex-turn-guard-4079.test.mjs`](../../../tests/codex-turn-guard-4079.test.mjs)
  - [`tests/codex-stderr-identity-4079.test.mjs`](../../../tests/codex-stderr-identity-4079.test.mjs)
  - [`tests/recovery-branch-restore-4079.test.mjs`](../../../tests/recovery-branch-restore-4079.test.mjs)

## 1. What happened

### Timeline (UTC)

| When                    | Event (log line)                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-17 15:40:35     | `turn.started` (`:324`). This is the only turn of the session: the final summary reports `thread.started=1, turn.started=1, item.completed=3747`.                                                                                  |
| 15:40 → 01:27           | 3,747 items complete inside that one turn. Solve warns that the session looped on `cat docs/CONTRIBUTING.md docs/javascript-first.md` 10 times.                                                                                    |
| 2026-11-18 01:27:18.858 | Codex emits one `codex.tool_result` telemetry record (`event.timestamp=…01:27:18.858Z`). Its `arguments=` hold the tool script the model wrote: reasoning with merged words (`Let'srunformatandtests.`), then 63,437 lines of `.`. |
| 01:27:18 → 01:29:53     | Solve writes the record line by line as `[STDERR] .` (`:105562`–`:168999`), about 60% of the log. Writing it took 2.5 minutes, although Codex printed it at once.                                                                  |
| 01:29:53.365            | The record's trailer: `SyntaxError: Unexpected identifier 'exactlog'`, then the run's account identifiers (`user.account_id=…`, `user.email=…`), `:169004`.                                                                        |
| 01:29:53.471            | `{"type":"error","message":"Incomplete response returned, reason: max_output_tokens"}`, then `turn.failed` (`:169005`–`:169007`). Turn usage: `input_tokens=124972379`, `cached_input_tokens=121094528`, `output_tokens=1019927`.  |
| 01:29:57                | The uncommitted work is preserved as `4a9410dd` on `recovery/issue-1-f401f7eb3981` (`:169134`). The failure comment does not name that branch. The work was later cherry-picked onto the PR branch by hand (`ef26fa9`).            |

## 2. Root causes

### 2.1. Nothing watched for degenerate output

Solve passed every stderr line through. Only `turn.failed` ended the session, and by then the response had already used its whole output budget. The 63,437 `.` lines were the model's own text, not tool output. Codex's `--json` protocol does not carry the arguments of a custom tool call; only the OpenTelemetry `codex.tool_result` record on stderr (under `--verbose`) carries them.

### 2.2. `max_output_tokens` was treated as fatal

`Incomplete response returned, reason: max_output_tokens` ends the turn, but the Codex session and the working tree are both intact. Solve had no resume path for it, so it posted "Solution Draft Failed" and left nine hours of work in an uncommitted working tree.

### 2.3. A single turn had no time or size bound

For nearly ten hours, all the work happened in one turn, with 125 million input tokens (121 million of them cached). A turn this long keeps its whole context, and that is where the model degenerated.

### 2.4. A multi-line telemetry record leaked into the published log

`codex-stderr-log.lib.mjs` (issue #3870) sends Codex `TRACE`/`DEBUG`/`INFO` lines to a separate trace file. It decided per line, though, and a `codex.tool_result` record spans many lines: a header line, continuation lines with the arguments, an ` output=…` line, and a trailer. Only the header looked like a tracing line. Everything else was logged as "not a tracing line". This included the trailer, which carries `user.account_id` and `user.email`. The token sanitizer did not touch them, because they are not credentials. `--attach-logs` then committed the log to a public repository. `experiments/issue-4079-redaction-check.mjs` finds 7,959 identity values in that log.

### 2.5. The recovery branch was not used by the next run

Issue #2315 pushes uncommitted work to `recovery/<branch>` when a run fails. The next `solve` of the same pull request starts from a fresh clone of the PR branch and never looked at that branch. The failure comment did not mention it either.

## 3. Fixes (pull request #4080)

| Suggested fix (issue)                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Detect degenerate output; collapse repeats in the log | `src/codex-turn-guard.lib.mjs` counts runs of identical or filler lines in the text the model writes: protocol item text and commands on stdout, and `codex.tool_result` arguments on stderr. Tool output is not counted. At `HIVE_MIND_CODEX_DEGENERATE_LINE_LIMIT` (200) lines, it stops the turn (`SIGTERM`, working tree untouched) and resumes the session. `src/codex-stderr-log.lib.mjs` keeps a record's continuation lines with their record and collapses repeated lines into `… previous line repeated N more times`. |
| 2. Resume after `max_output_tokens`                      | `decideCodexContinuation` resumes the same Codex session (`codex exec resume`) with a continuation prompt (`locales/prompts/recovery.en.lino`): the previous response was truncated, continue from the current working tree in shorter steps. This is limited to `HIVE_MIND_CODEX_MAX_TRUNCATION_RESUMES` (3) per run. Turn failures for any other reason keep their existing handling.                                                                                                                                          |
| 3. Bound a single turn                                   | The same guard ends a turn after `HIVE_MIND_CODEX_MAX_TURN_MINUTES` (240), or after `HIVE_MIND_CODEX_MAX_TURN_INPUT_TOKENS` (100,000,000; this needs `--verbose`, because the token counts come from stderr telemetry). It resumes the session, up to `HIVE_MIND_CODEX_MAX_TURN_SPLITS` (20) times per run. It never stops a turn while a command, file change or MCP call is in progress.                                                                                                                                       |
| 4. Redact account identifiers                            | `src/telemetry-identity-redaction.lib.mjs` replaces the value after `user.email`, `user.account_id`, `user.account_uuid`, `user.id`, `chatgpt_account_id`, `chatgpt_user_id` and `organization.id` with `<redacted>`. It runs on kept Codex stderr lines, on the trace file, and in `sanitizeOutput`, which every published log goes through.                                                                                                                                                                                    |
| 5. Use the recovery branch on the next run               | On a continue run, `src/recovery-branch-restore.lib.mjs` fetches `recovery/<branch>`. If the PR branch is still at the commit the work was preserved from, it applies the changes as uncommitted changes. If the PR branch already contains them, it does nothing. Otherwise it tells the session where the work is (`git diff HEAD origin/recovery/<branch>`). The recovery branch is never deleted. The failure comment now names the recovery branch and commit.                                                              |

All five limits can be set through environment variables, and `0` disables a limit (see `docs/CONFIGURATION.md`, section 4.3).

## 4. Replaying the incident

- `node experiments/issue-4079-degenerate-replay.mjs solve.log` shows that the detector fires at log line 105,761 (`01:27:19.505`), 200 lines into the `.` run. That is 63,244 log lines before the `max_output_tokens` error.
- `node experiments/issue-4079-stderr-replay.mjs solve.log` shows that of the 156,938 stderr lines the original log kept, 531 stay in the log and the rest go to the trace file. There, the `.` run collapses into one line. No unredacted identity line is kept.
- `node experiments/issue-4079-redaction-check.mjs solve.log` shows that 7,959 identity values are redacted and none are left.

## 5. Limitations

- In this incident, Codex printed the degenerate record all at once, after the model had already finished generating it. Stopping the turn early could not have saved those output tokens. What helps here is keeping the record out of the log, which also saves the 2.5 minutes spent writing it, and the `max_output_tokens` resume. Early stopping helps when degenerate text streams in, as stdout message and reasoning items do.
- The input-token budget only works with `--verbose`, because Codex reports per-response token counts only in its stderr telemetry. The time budget always works.
- A restored recovery branch is left uncommitted on purpose. The session reviews it and decides what to keep.
