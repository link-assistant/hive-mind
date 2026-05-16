# Case Study: Issue #1809 — Gemini Tool Does Not Produce Meaningful JSON Output, Feature Gaps vs Claude/Codex

- **Issue:** [link-assistant/hive-mind#1809](https://github.com/link-assistant/hive-mind/issues/1809)
- **Pull Request:** [link-assistant/hive-mind#1810](https://github.com/link-assistant/hive-mind/pull/1810)
- **Branch:** `issue-1809-ad1b428698b3`
- **Reporter:** @konard
- **Reported (run timestamp):** 2026-05-16T11:00:06Z
- **Gemini CLI version in scope:** 0.42.x family (latest at time of write)
- **Hive-mind version at reproduction:** 1.70.0

## TL;DR

When invoking `gemini` with `--output-format stream-json` and no auth configured, the
upstream Gemini CLI prints a plain-text error and exits with code `41`
(`FATAL_AUTHENTICATION_ERROR`) instead of emitting a structured `error` /
`result` JSONL event. Our wrapper in `src/gemini.lib.mjs`:

1. Treated the run as a success because the JSONL parser produced 0 `errorMessages`
   and the wrapper did not strictly enforce `exitCode !== 0` (it did, but the
   `command-stream` pipe `cat | gemini` could swallow the non-zero exit code in
   some shells because `pipefail` is not set).
2. Did not surface plain-text errors emitted on stdout/stderr when no JSON could
   be parsed.
3. Missed multiple gemini-cli flags that Claude/Codex wrappers expose (debug,
   include directories, MCP allow-list, extensions, sandbox, etc.).

This case study documents the timeline, the requirements derived from the
issue, the root causes (both upstream and in our wrapper), the proposed
solutions, the upstream issue we filed, and the changes shipped in PR #1810.

## Index

- [`timeline.md`](./timeline.md) — sequence of events and reproduction
- [`requirements.md`](./requirements.md) — every requirement extracted from #1809
- [`root-causes.md`](./root-causes.md) — root cause analysis (upstream + wrapper)
- [`solutions.md`](./solutions.md) — implementation plan with mapping to commits
- [`upstream-issue-draft.md`](./upstream-issue-draft.md) — text submitted to
  `google-gemini/gemini-cli`
- [`logs/`](./logs/) — raw run logs preserved for forensic review

## Quick facts

| Symptom                                                            | Where                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Plain-text error `Please set an Auth method ...` instead of JSON   | gemini-cli `validateNonInteractiveAuth`                                  |
| Our log shows `✅ Gemini command completed` despite auth failure   | `src/gemini.lib.mjs` success path                                        |
| `stream-json` skips the structured `error` event for auth failures | gemini-cli only emits structured JSON when `OutputFormat.JSON`           |
| `messageCount: 0` and `toolUseCount: 0` are reported as success    | Wrapper does not require a `result` event to consider the run successful |

## Linked artifacts

- Source: `src/gemini.lib.mjs`, `src/gemini.prompts.lib.mjs`, `src/solve.mjs`
- Tests: `tests/test-gemini-support.mjs`
- Upstream Gemini CLI sources reviewed:
  - `packages/cli/src/validateNonInterActiveAuth.ts`
  - `packages/cli/src/utils/errors.ts`
  - `packages/core/src/output/types.ts`
  - `packages/core/src/output/stream-json-formatter.ts`
  - `packages/cli/src/nonInteractiveCli.ts`

## See also

- Claude integration reference: `src/claude.lib.mjs` (`executeClaudeCommand`)
- Codex integration reference: `src/codex.lib.mjs`
- Gemini official docs: <https://github.com/google-gemini/gemini-cli/tree/main/docs/cli>
