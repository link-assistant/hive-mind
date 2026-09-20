# Issue 1666 Case Study

Issue: `Codex: Selected model is at capacity. Please try a different model.`

PR: `https://github.com/link-assistant/hive-mind/pull/1667`

## Evidence Collected

- `data/issue-1666.json`: issue body snapshot
- `data/issue-1666-comments.json`: issue comments snapshot
- `data/pr-1667.json`: PR metadata snapshot before implementation
- `raw/full-log.txt`: upstream log artifact fetch result

## External Facts Checked

- Anthropic CLI reference documents `claude --resume` and says resumed conversations continue with the same model and configuration: https://docs.anthropic.com/en/docs/claude-code/cli-reference and https://docs.anthropic.com/en/docs/claude-code/tutorials
- OpenCode CLI docs document `opencode run --session` as the way to continue a session: https://opencode.ai/docs/cli/
- Local CLI help confirmed `codex exec resume --model <MODEL>` is supported, which is the key requirement for same-session fallback retries in Codex

## Requirements Extracted From The Issue

1. Retry the Codex capacity error by default with exponential backoff.
2. Add `--fallback-model`.
3. Resume the same session with the fallback model when the tool supports it.
4. Use Claude Opus 4.6 as the implicit fallback for Claude Opus 4.7.
5. Use GPT-5.4 as the implicit fallback for Codex GPT-5.5.
6. Leave all other models without an implicit fallback.
7. Verify the behavior across all tool integrations.
8. Preserve issue data in the repository.

## Timeline

- The issue and PR state were captured locally on 2026-04-24.
- The linked upstream raw log artifact was no longer available and returned `404 Not Found`.
- The runtime integrations were traced through `src/claude.lib.mjs`, `src/codex.lib.mjs`, `src/opencode.lib.mjs`, `src/agent.lib.mjs`, `src/solve.config.lib.mjs`, and resume/reporting code in `src/solve*.mjs`.

## Root Causes

- `--fallback-model` did not exist in the shared CLI configuration, so neither explicit nor default model fallback could be configured.
- Codex had retry scaffolding (`retryCount`, `executeWithRetry`) but returned immediately on the first error instead of retrying transient failures.
- Codex resume execution did not pass `--model`, so even a selected fallback model would not apply on resume.
- OpenCode resume integration used `--resume`, while the current CLI documents `--session` for continuing a session.
- Agent integration ignored `argv.resume`, so same-session retries were impossible there.
- Reporting code reused the mutable active model, which would hide fallback behavior in logs/comments after a model switch.

## Solution Implemented

- Added shared fallback-model resolution in `src/models/index.mjs`.
- Added shared retry classification and fallback switching helpers in `src/tool-retry.lib.mjs`.
- Added `--fallback-model` to the shared solve CLI config with automatic defaults only for Opus 4.7 and GPT-5.5.
- Enabled transient retry loops with exponential backoff in Codex, OpenCode, and Agent.
- Extended Claude transient retry handling to recognize capacity errors and switch to fallback models when configured.
- Fixed Codex resume to pass `--model` on `codex exec resume`.
- Fixed OpenCode resume to use `--session`.
- Fixed Agent resume to use `--resume ... --no-fork`.
- Preserved the original requested model separately from the active retry model for log/comment reporting.

## Verification

- `node tests/test-codex-support.mjs`
- `npm test`
