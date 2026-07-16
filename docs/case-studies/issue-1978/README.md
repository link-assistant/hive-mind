# Issue 1978 Case Study: Claude Code Subagent Model Override

## Summary

Issue #1978 requested a way to choose a better Claude Code model for native subagents and agent teams without changing the default behavior. The implemented solution adds `--sub-agent-model` to `solve`, `hive`, and Telegram command parsing. When present with `--tool claude`, the option maps Claude model aliases or full IDs to `CLAUDE_CODE_SUBAGENT_MODEL`. When omitted, Hive Mind does not set that environment variable.

## Local Evidence

- Issue snapshot: `raw/issue-1978.json`
- Prepared PR snapshot: `raw/pr-1987.json`
- Upstream documentation notes: `raw/online-sources.md`
- Regression test: `tests/test-issue-1978-sub-agent-model.mjs`

## Upstream Facts

Official Claude Code documentation identifies `CLAUDE_CODE_SUBAGENT_MODEL` as the supported model override for all subagents and agent teams. It overrides per-invocation model parameters and subagent frontmatter, and accepts `inherit` to use normal Claude Code subagent model resolution.

The same docs list `ANTHROPIC_DEFAULT_HAIKU_MODEL` as the replacement for deprecated `ANTHROPIC_SMALL_FAST_MODEL`, but that variable controls the `haiku` alias/background functionality rather than an explicit all-subagents override. The CLI reference documents `--model` for the current/main session; no separate Claude CLI `--sub-agent-model` flag is documented.

## Requirements

1. Check current Claude Code docs, defaults, and options.
   - Done in `raw/online-sources.md`.

2. Add a user-facing `--sub-agent-model` option for `solve`.
   - Implemented in `SOLVE_OPTION_DEFINITIONS`.

3. Support the same option in `hive`.
   - Hive auto-registers solve passthrough options and forwards `--sub-agent-model` to workers.
   - Hive also validates the option before starting worker sessions.

4. Support Telegram bot commands and overrides.
   - Telegram uses the same solve/hive yargs configs, so the option parses in `/solve` and `/hive`.
   - Telegram early validation now rejects invalid `--sub-agent-model` values before worker launch.

5. Pass the selected value through to Claude Code CLI.
   - Direct Claude execution sets `CLAUDE_CODE_SUBAGENT_MODEL` in `getClaudeEnv`.
   - The agent-commander Claude path sets the same env var in `toolOptions.extraEnv`.
   - Aliases such as `sonnet` are resolved to full Claude IDs before setting the env var.

6. Keep defaults unchanged.
   - `getClaudeEnv({})` does not add `CLAUDE_CODE_SUBAGENT_MODEL`.
   - Existing process env values are still inherited normally.

7. Check other tools.
   - The option is Claude-only because the upstream control is Claude Code-specific.
   - Solve/hive validation rejects `--sub-agent-model` with non-Claude tools.
   - Agent-commander does not pass the Claude subagent env var to Codex/OpenCode/Agent/Qwen/Gemini.

## Considered Solutions

- Pass a hypothetical Claude CLI `--sub-agent-model` flag.
  - Rejected: the current official CLI reference documents `--model` for the main session, while subagent selection is documented as `CLAUDE_CODE_SUBAGENT_MODEL`.

- Set `ANTHROPIC_DEFAULT_HAIKU_MODEL` or deprecated `ANTHROPIC_SMALL_FAST_MODEL`.
  - Rejected: these affect the `haiku` alias/background behavior, not an explicit all-subagents override.

- Set `CLAUDE_CODE_SUBAGENT_MODEL` only when the user passes a Hive Mind option.
  - Chosen: matches official docs, preserves defaults, supports aliases/full IDs, and exposes `inherit`.

## Verification Matrix

| Requirement                     | Verification                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Solve parses the option         | `tests/test-issue-1978-sub-agent-model.mjs` parses `--sub-agent-model sonnet` with solve yargs |
| Hive parses/forwards the option | Test checks hive yargs and `getSolvePassthroughOptionNames()`                                  |
| Default remains unset           | Test deletes local process env and checks `getClaudeEnv({})`                                   |
| Alias/full ID support           | Test checks `sonnet` resolves to `claude-sonnet-4-6`                                           |
| `inherit` support               | Test checks `inherit` and `INHERIT` resolve to `inherit`                                       |
| agent-commander support         | Test checks Claude `toolOptions.extraEnv.CLAUDE_CODE_SUBAGENT_MODEL`                           |
| Other tools unaffected          | Test checks Codex tool options do not receive Claude subagent env                              |
