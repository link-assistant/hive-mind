# Issue 516 Case Study: Direct Gemini Tool Support

Status: implementation updated on 2026-05-01 for PR #559.

## Saved Data

- `issue-516.json`: current issue title/body/metadata.
- `issue-comments.json`: issue discussion, including the note that related work in #1043 and `link-assistant/agent-commander#13` should be considered.
- `pr-559.json`: PR metadata and edited description from before this update.
- `pr-conversation-comments.json`: PR discussion, including the 2026-05-01 request to merge latest default branch and modernize direct Gemini support using the current Claude/Codex/OpenCode/Agent patterns.
- `pr-review-comments.json` and `pr-reviews.json`: review data snapshots.
- `recent-ci-runs.json`: recent branch CI snapshot available when this work resumed.

## External Research

Official Gemini CLI documentation was checked before updating the implementation:

- Gemini CLI reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md
- Gemini CLI headless mode reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md

Relevant facts from the official docs:

- Gemini CLI supports non-interactive execution through `-p`/`--prompt`, positional prompts in non-TTY mode, and piped stdin.
- `--model` accepts aliases including `auto`, `pro`, `flash`, and `flash-lite`.
- `--output-format` supports `text`, `json`, and `stream-json`.
- `stream-json` returns newline-delimited events, including session metadata, messages, tool use/results, errors, and a final result event with usage statistics.
- `--approval-mode yolo` is the current auto-approval mode, replacing the deprecated `--yolo` alias.
- `--skip-trust` skips the folder trust prompt for the current session.
- `--resume` can continue previous Gemini CLI sessions.

## Requirements

1. Add `--tool gemini` as a direct solve/hive tool, similar to existing direct tool integrations.
2. Prefer structured output over plain text when Gemini CLI supports it.
3. Verify the command shape locally and keep automated coverage that does not require live Gemini credentials.
4. Bring the branch up to date with the latest default branch before finalizing.
5. Apply current direct-tool patterns from Claude, Codex, OpenCode, and Agent where they make sense for Gemini.
6. Save issue and PR research data in `docs/case-studies/issue-516`.
7. Account for the stale failed CI check.

## Design

- Keep Gemini model aliases in the centralized models module: `flash`, `pro`, `flash-lite`, and `auto`.
- Use `flash` as the direct Gemini default to match the current fast/balanced Gemini CLI alias.
- Run Gemini CLI in headless structured mode with `--output-format stream-json`.
- Pass `--model`, `--approval-mode yolo`, and `--skip-trust` for autonomous solve runs.
- Preserve resume support by passing `--resume` when a Gemini session id is available.
- Parse JSONL output incrementally to collect session id, message count, tool-use count, error text, final summary, and model usage.
- Reuse common retry, usage-limit, model-fallback, prompt, workspace tmp, Playwright prompt, uncommitted-change, queue, and Telegram alias patterns where applicable.
- Treat agent-commander Gemini support as adjacent work because issue comments point to `link-assistant/agent-commander#13`; this PR focuses on direct `gemini` execution.

## Existing Components Reused

- `models/index.mjs` for aliases, validation, display names, and default models.
- `tool-retry.lib.mjs` for transient retry classification, retry delays, and fallback-model switching.
- `usage-limit.lib.mjs` for limit detection and resume messaging.
- `playwright-mcp.lib.mjs` for optional Playwright prompt availability checks.
- `telegram-solve-queue.lib.mjs` and queue helpers for per-tool queue state and running-process snapshots.
- Existing Claude/Codex/OpenCode/Agent prompt and execution modules as implementation references.

## Alternatives Considered

- Plain text output: rejected because the issue explicitly prefers JSON/structured output and Gemini CLI has `json`/`stream-json`.
- One-shot `--output-format json`: useful for validation, but less suitable for long autonomous runs because streaming JSONL allows incremental logging and event parsing.
- Agent Commander only: deferred because the issue and PR comments distinguish direct `gemini` work from the separate `agent-commander` dependency work.
- Hardcoded Gemini model maps inside `gemini.lib.mjs`: rejected in favor of the central model registry so validation, CLI help, comments, and execution stay consistent.

## CI Finding

The failed PR check visible at resume time was from old branch SHA `8eba1cdfad0b0af10fc7797a7fdfe7b17f948dbb`, created on 2025-10-14. The run logs had expired with GitHub HTTP 410, but job metadata showed the failing job was `verify-version-bump`; other listed checks were passing or skipped. This update adds a changeset so the next fresh CI run has the release trigger it expects.

## Verification Plan

- Syntax-check changed source files with `node --check`.
- Run focused Gemini, model-info, queue, Telegram alias, docs-sync, and tool-default tests.
- Run the default suite through `npm test`.
- Run `npm run lint`, `npm run format:check`, and `git diff --check`.
- After push, check fresh CI runs for branch `issue-516-54126055` and inspect logs if any new run fails.
