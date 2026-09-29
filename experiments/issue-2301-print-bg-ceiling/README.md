# Issue 2301: Claude Code print-mode background-task ceiling

Reproduces and analyses what Claude Code 2.1.284 does to background work when a `claude -p` turn ends. See [the case study](../../docs/case-studies/issue-2301/README.md) for the full analysis.

| File                                                             | Purpose                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`repro-ceiling.sh`](repro-ceiling.sh)                           | Live repro in about a minute: runs the ceiling, the bash-only exit, and the fixed env (needs an authenticated `claude`; writes to `./out/`). |
| [`replay-before-after.mjs`](replay-before-after.mjs)             | Replays both incident fixtures through `origin/main`'s stream folding and through this branch's.                                             |
| [`incident-events.mjs`](incident-events.mjs)                     | Rebuilds top-level stream-json events from a pretty-printed `solve` log (`[INFO] {` blocks), with the log timestamp as `__logTs`.            |
| [`build-fixture.mjs`](build-fixture.mjs)                         | Cuts the compact replay fixtures in `tests/fixtures/issue-2301/` from that reconstruction.                                                   |
| [`timeline.mjs`](timeline.mjs), [`summarize.mjs`](summarize.mjs) | Print an event timeline (`node timeline.mjs incident.jsonl 2026-09-28T21:50`) or result and task summaries.                                  |
| `captured/`                                                      | Stream-json from the live runs (timestamped `.tsv` plus stderr; SDK request logs removed).                                                   |

## Findings (Claude Code 2.1.284, `--model haiku`)

| Run                                                                                 | Result                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Background Agent, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=8000` (`run-agent-ceiling`) | stderr: `Background tasks still running after 8s; terminating.…`. Then `task_notification status=stopped`, `result` `success` with `killed.system=1`, and inside the subagent a synthetic `[Request interrupted by user]` / `tool_use_result: "User rejected tool use"`. |
| Background Bash `sleep 90` (`run-ceiling20`)                                        | No wait and no stderr line. The task is `stopped` about 4 s after the result, with `killed.system=0`. So `killed.system` alone misses this case.                                                                                                                         |
| Same Agent with the hive-mind env (`run-agent-fixed`)                               | `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, `CLAUDE_CODE_DISABLE_WORKFLOWS=1`, `CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND=1`: the agent runs in the foreground and `completed`; the result has `started_in_background=0` and includes its reply.                             |
| `background-default.jsonl` / `background-disabled.jsonl`                            | An Agent plus a Bash command without the env produce three results in one print run. With the env, they produce one result and nothing starts in the background.                                                                                                         |

In the binary, the ceiling is `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? 600000` and the kill switch is `backgroundTasksDisabled || CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`. Setting the ceiling to `0` waits forever, so hive-mind does not do that: a stuck task would hang `solve`.
