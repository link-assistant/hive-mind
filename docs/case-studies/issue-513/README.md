# Issue 513: Direct Qwen Code Support

## Context

Issue #513 asks Hive Mind to add Qwen support. The updated issue and pull
request comments clarified that Qwen should be invoked directly, should prefer
structured output when the CLI offers it, and should be tested through the same
local command path that production uses.

Related follow-up links from the issue thread:

- https://github.com/link-assistant/hive-mind/issues/1043
- https://github.com/link-assistant/agent-commander/issues/11

## Requirements

- Add `--tool qwen` to `solve`, `hive`, Telegram solve aliases, model
  validation, version reporting, and restart paths.
- Use the Qwen CLI binary directly instead of routing through another tool.
- Prefer non-plain-text CLI output for reliable parsing.
- Preserve session IDs where Qwen emits them so retry and resume flows can keep
  context.
- Carry the current default-branch tool architecture forward. This branch was
  stale relative to main, so the work needed to merge main before completing the
  implementation.
- Add a changeset because the pull request had a failing version-bump check.
- Document the investigation and final design in `docs/case-studies/issue-513`.

## Qwen Code Research

Official Qwen Code references used:

- Qwen Code repository: https://github.com/QwenLM/qwen-code
- Headless mode documentation: https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/
- CLI commands documentation: https://qwenlm.github.io/qwen-code-docs/en/cli/commands/
- NPM package: https://www.npmjs.com/package/@qwen-code/qwen-code

Findings from the official docs:

- The package is `@qwen-code/qwen-code` and the CLI binary is `qwen`.
- Headless mode supports `--prompt` / `-p`, which fits Hive Mind's noninteractive
  solve workflow.
- `--output-format` supports `text`, `json`, and `stream-json`. `stream-json`
  is the best match for Hive Mind because it can stream events while still
  giving structured session, result, and error data.
- `--yolo` enables auto-accept behavior, matching the existing noninteractive
  execution style used by other supported tools.
- `--model` / `-m` selects the model, and `--resume <session_id>` resumes an
  existing Qwen session.

## Existing Architecture

The current default branch centralized model metadata in `src/models/index.mjs`
and routes execution through tool-specific wrappers:

- `src/claude.lib.mjs`
- `src/opencode.lib.mjs`
- `src/codex.lib.mjs`
- `src/agent.lib.mjs`
- `src/solve.restart-shared.lib.mjs`

That made the safest implementation path a dedicated `src/qwen.lib.mjs` wrapper
plus model registry additions, rather than adding Qwen special cases inside the
Claude, Codex, or OpenCode wrappers.

## Solution Options

### Option 1: Reuse another tool wrapper

Rejected. It would be fast, but it would hide Qwen-specific output, session, and
resume behavior behind a different CLI contract.

### Option 2: Plain text Qwen invocation

Rejected. The issue explicitly prefers structural output, and Qwen documents
`--output-format json` and `--output-format stream-json`.

### Option 3: Direct Qwen wrapper with stream-json

Selected. The final wrapper runs Qwen directly with:

```bash
qwen --model <model> --output-format stream-json --yolo --prompt "$(cat prompt-file)"
```

When a system prompt is available, Hive Mind passes it through Qwen's
`--append-system-prompt` option. When a session is available, Hive Mind passes
`--resume <session_id>`.

## Implementation Summary

- Added Qwen model aliases and default model `qwen3-coder-plus`.
- Added `--tool qwen` choices to solve and hive configuration.
- Added Qwen validation using `qwen --version` and a small structured headless
  prompt.
- Added Qwen execution through `src/qwen.lib.mjs`, including stream-json parsing,
  session ID extraction, result summary extraction, retry handling, and usage
  limit detection.
- Added Qwen prompt construction in `src/qwen.prompts.lib.mjs` using the same
  current guidelines as the other tool prompts.
- Added Qwen to Telegram aliases and queue process tracking.
- Added Qwen to version reporting using `qwen --version`.
- Updated README and configuration docs, including translated sibling docs so
  the documentation language sync check stays satisfied.

## CI Investigation

The pull request had one failing check: `verify-version-bump`.

Recent branch runs were old, from October 14, 2025, and pointed at an older
commit. Attempts to download the historical logs with `gh run view --log` failed
with GitHub `HTTP 410`, meaning the logs had expired. The actionable finding was
still clear from the check name and repository release setup: add a changeset.

The PR now includes `.changeset/qwen-code-support.md`.

## Verification

Focused tests added or updated:

- `tests/test-qwen-support.mjs` verifies model registry behavior, stream-json
  parsing, command construction, resume propagation, and retry behavior with a
  preserved session ID.
- `tests/test-tool-specific-defaults.mjs` verifies `--tool qwen` keeps the
  `.gitkeep` task-file default.
- `tests/test-telegram-bot-command-aliases.mjs` verifies `/qwen` maps to
  `/solve --tool qwen`.
- `tests/test-issue-882-fixes.mjs` and `tests/model-info.test.mjs` cover Qwen
  model mapping and user-facing model/tool display.

Manual live validation should run:

```bash
qwen --version
qwen --prompt "Respond with exactly: hi" --model qwen3-coder-plus --output-format json --yolo
```

If Qwen Code is not installed or not authenticated locally, automated tests still
exercise the production command builder and structured-output parser with mocked
CLI streams.
