# Case Study: `--development-log` Option

## Problem Statement

Issue 1596 asks for a solve option that makes development logs first-class, durable artifacts. The agent receives one issue-type-aware data-collection sentence. Independently, the solve algorithm preserves the native tool session under `./dev/log/issues/{issue-id}/pulls/{pull-id}/sessions/{UUID}` and commits it so a stateless server restart does not destroy resumable context.

## Requirements

- Add a `--development-log` boolean option.
- Use `./dev/log/issues/{issue-id}/pulls/{pull-id}` as the development-log path.
- Append exactly the issue-type-specific data-collection sentence to the regular user/start prompt, not the system prompt.
- Automatically select the wording by GitHub issue type: stronger bug wording (download all logs and collect issue-related data) for `Bug` issues, and the universal feature/task wording (collect issue-related data) for feature/task issues or when no issue type is selected.
- Make session persistence and committing the solve algorithm's responsibility, not the AI agent's.
- Store each run under `sessions/{UUID}` so sessions remain distinct and can be reused for future resume operations.
- Track and commit available Claude, Codex, or equivalent native session files when possible, with the solve log as a fallback/supporting artifact.
- Support all solve tools where practical.
- Create the requested implementation case study in `./docs/case-studies/issue-{id}` as repository documentation, without bloating the runtime agent prompt.

## Research

- Claude Code documents resumable sessions and local transcript handling. Its session page notes JSONL transcripts under `~/.claude/projects/<project>/<session-id>.jsonl`, which matches existing hive-mind Claude token/session lookup code.
- OpenAI Codex CLI documents resumable sessions through `codex resume` and `codex exec resume`. Codex persists each session as a rollout transcript under `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<sessionId>.jsonl`; the date path and timestamp are not derivable from the session id, so the implementation locates the file by recursively matching the `-<sessionId>.jsonl` suffix. hive-mind's own solve log is always preserved as a fallback.
- GitHub CLI supports downloading workflow logs with `gh run view --log`, which is the correct primitive for future `--development-log` sessions that need CI evidence.

References:

- <https://code.claude.com/docs/en/sessions>
- <https://developers.openai.com/codex/cli/features>
- <https://cli.github.com/manual/gh_run_view>

## Known Components

- `src/solve.config.lib.mjs`: source of truth for solve CLI options.
- `src/hive.config.lib.mjs`: auto-registers solve passthrough options for hive.
- `src/*prompts.lib.mjs`: tool-specific initial prompt builders.
- `src/solve.mjs`: finalization flow after tool execution, verification, log attachment, cleanup, and session teardown.
- `src/claude.lib.mjs`: existing pattern for Claude session files under `~/.claude/projects/`.
- `docs/CONFIGURATION.md`: docs sync target enforced by tests.

## Solution Plan

The prompt-only option would satisfy the visible instruction text but would not preserve artifacts automatically. Conversely, asking the agent to locate and commit its own session is unreliable: it may not know its native storage layout, may terminate before doing so, and cannot guarantee completion during failures. The selected plan separates these responsibilities:

1. Generate stable development-log and case-study paths from issue and PR numbers.
2. Detect the GitHub issue type (`gh issue view --json issueType`) once per run and inject only the matching instruction line: the bug "download all logs" wording for `Bug` issues, otherwise the universal data-collection wording.
3. Append only that one sentence in every supported tool's regular user/start prompt, keeping it out of the system prompt.
4. Let solve copy the solve log and known native session files into `dev/log/.../sessions/{UUID}/` (Claude `~/.claude/projects/.../<sessionId>.jsonl` and Codex `~/.codex/sessions/.../rollout-*-<sessionId>.jsonl`; the solve log remains available for tools whose native store is unavailable or unknown).
5. Write per-session `metadata.json` describing the tool, session UUID, run, and artifact paths.
6. Stage, pathspec-commit, and push only the development-log subtree during solve finalization.

This keeps the new behavior isolated from the earlier uncommitted-change auto-restart flow and avoids tool-specific duplication.

## Validation

The reproducer test `tests/test-development-log-option-1596.mjs` verifies:

- `--development-log` is registered and defaults to false.
- Hive passthrough includes the option.
- All six user-prompt builders include the one requested collection sentence, all six system prompts exclude it, and none delegate persistence, commits, or case-study work to the agent.
- Bug issues receive the "download all logs" wording while feature/task or unspecified issues receive the universal data-collection wording, and `fetchIssueType` parses the gh CLI output while tolerating failures.
- Artifact writing creates `sessions/{UUID}`, copies the solve log, and records per-session metadata.
- Claude and Codex native transcripts are discovered and copied into their respective UUID directories.
- Runs without an emitted session UUID receive a timestamped `sessions/run-*` fallback directory rather than overwriting another run.
