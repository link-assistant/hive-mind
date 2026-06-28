# Case Study: `--development-log` Option

## Problem Statement

Issue 1596 asks for a solve option that makes development logs first-class review artifacts. A run should collect issue and PR data into `./dev/log/issues/{issue-id}/pulls/{pull-id}`, create case-study material under `./docs/case-studies/issue-{id}`, and preserve tool session files when possible.

## Requirements

- Add a `--development-log` boolean option.
- Use `./dev/log/issues/{issue-id}/pulls/{pull-id}` as the development-log path.
- Append clear data-collection instructions to the initial prompt.
- Use stronger bug wording: download all logs and collect issue-related data.
- Use feature/task wording: collect issue-related data.
- Track and commit available Claude, Codex, or equivalent session files when possible.
- Support all solve tools where practical.
- Create case-study documentation in `./docs/case-studies/issue-{id}` with requirements, analysis, known components/libraries, and solution plans.

## Research

- Claude Code documents resumable sessions and local transcript handling. Its session page notes JSONL transcripts under `~/.claude/projects/<project>/<session-id>.jsonl`, which matches existing hive-mind Claude token/session lookup code.
- OpenAI Codex CLI documents resumable sessions through `codex resume` and `codex exec resume`, but public docs do not promise a stable local transcript path. The implementation therefore always preserves hive-mind's solve log and leaves room for tool-specific collectors.
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

The prompt-only option would satisfy the visible instruction text but would not preserve artifacts automatically. The selected plan adds a shared helper that does both:

1. Generate stable development-log and case-study paths from issue and PR numbers.
2. Provide one prompt block reused by all supported tools.
3. Copy the solve log and known session files into `dev/log/.../sessions/`.
4. Write `metadata.json` describing the run and artifact paths.
5. Stage, commit, and push only the development-log subtree at the end of a successful solve run.

This keeps the new behavior isolated from the earlier uncommitted-change auto-restart flow and avoids tool-specific duplication.

## Validation

The reproducer test `tests/test-development-log-option-1596.mjs` verifies:

- `--development-log` is registered and defaults to false.
- Hive passthrough includes the option.
- All six prompt builders include the shared development-log instructions.
- Artifact writing creates the requested directory, copies the solve log, and records metadata.
