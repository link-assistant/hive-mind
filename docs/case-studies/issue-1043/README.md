# Issue 1043: Optional agent-commander Execution

## Scope

Issue: https://github.com/link-assistant/hive-mind/issues/1043

Pull request: https://github.com/link-assistant/hive-mind/pull/1044

The request is to add an experimental `--use-agent-commander` option. When it is not set, hive-mind must keep using the existing embedded tool adapters. When it is set, tool execution for `claude`, `codex`, `opencode`, `agent`, `qwen`, and `gemini` should go through `agent-commander` where upstream support exists.

## Evidence

Raw evidence collected for this case study is in `data/`:

- `issue-1043.json`: issue title, body, and comments.
- `pr-1044.json`, `pr-1044-comments.json`, `pr-1044-review-comments.json`, `pr-1044-reviews.json`: PR state and feedback.
- `agent-commander-npm-0.6.0.json`: current npm package metadata.
- `agent-commander-release-js-0.6.0.json`: current GitHub release metadata.
- `agent-commander-tools-files-0.6.0.json`: upstream README and tool implementation snapshots.
- `agent-commander-issue-29.json`, `agent-commander-issue-30.json`: earlier upstream parity issues now closed by the latest agent-commander release.
- `agent-commander-issue-35.json`: upstream issue opened for the remaining `qwen`/`gemini` parity gaps.
- Older `agent-commander@0.4.3` files are retained as historical evidence from the first implementation pass.
- `online-sources.md`: online sources checked.

Online sources checked:

- https://www.npmjs.com/package/agent-commander
- https://github.com/link-assistant/agent-commander
- https://github.com/link-assistant/agent-commander/releases/tag/js_0.6.0

`agent-commander@0.6.0` was published in release `js_0.6.0` on 2026-05-01T10:55:52Z. It adds `qwen` and `gemini` tools plus normalized result metadata and raw passthrough support for `claude`, `codex`, `opencode`, and `agent`.

## Requirements

- Add a `--use-agent-commander` CLI option.
- Keep the option experimental and disabled by default.
- Preserve all existing behavior when the option is not selected.
- Make `hive` pass the option to `solve` workers.
- When selected, route supported tool execution through `agent-commander`.
- Cover `claude`, `codex`, `opencode`, `agent`, `qwen`, and `gemini`.
- Validate that the latest `agent-commander` package supports the selected tool.
- Keep watch and auto-restart iterations on the same execution path.
- Document missing upstream features and open issues in `link-assistant/agent-commander` where needed.

## Implementation

The option lives in `SOLVE_OPTION_DEFINITIONS` as hidden, boolean, and default `false`. `hive` already registers and forwards solve passthrough options from that shared map, so no duplicate hive option wiring is needed.

Default behavior is preserved by guarding every `agent-commander` path behind `argv.useAgentCommander`. The existing embedded branches in `solve.mjs` and `solve.restart-shared.lib.mjs` still handle `claude`, `codex`, `opencode`, `agent`, and `qwen` when the flag is absent. `gemini` is currently enabled only through `--use-agent-commander`.

The adapter in `src/agent-commander.lib.mjs` centralizes:

- supported tool validation
- `agent-commander` availability checks
- dry-run connection validation
- prompt construction through the existing per-tool prompt modules
- Playwright MCP prompt availability gating
- result normalization back into the shape expected by solve post-processing
- generic uncommitted-change detection for the agent-commander execution path

## Compatibility Matrix

| Hive-mind feature                                            | agent-commander 0.6.0 status  | PR handling                                                           |
| ------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------- |
| Basic tool launch for `claude`, `codex`, `opencode`, `agent` | Supported                     | Routed through `agent()` when `--use-agent-commander` is set          |
| Basic tool launch for `qwen`, `gemini`                       | Supported                     | Routed through `agent()` when `--use-agent-commander` is set          |
| Model selection                                              | Supported                     | Passed as `model`                                                     |
| Resume/session id                                            | Tool-specific support         | Passed as `resume`                                                    |
| Large generated prompts                                      | Supported for first 4 tools   | Uses prompt/systemPrompt API; `qwen`/`gemini` gap reported upstream   |
| Claude fallback model                                        | Supported                     | Passed via `toolOptions.fallbackModel`                                |
| Claude verbose flag                                          | Supported                     | Passed via `toolOptions.verbose`                                      |
| Codex reasoning/context flags                                | Mostly supported via raw args | Passed via `toolOptions.extraArgs`                                    |
| JSON result capture                                          | Supported                     | Adapter reads `result.metadata` and falls back to parsed/plain output |
| Playwright MCP prompt hints                                  | Hive-mind-specific            | Adapter reuses existing availability checks and toggles prompt hints  |
| Raw executable/env/args for `qwen`, `gemini`                 | Missing parity                | Reported upstream in agent-commander issue 35                         |

## Upstream Issues

- https://github.com/link-assistant/agent-commander/issues/29: execution parity options for `claude`, `codex`, `opencode`, and `agent`; closed before this update.
- https://github.com/link-assistant/agent-commander/issues/30: normalized result metadata for hive-mind solve sessions; closed before this update.
- https://github.com/link-assistant/agent-commander/issues/35: remaining `qwen`/`gemini` prompt-file and passthrough parity gaps; opened from this update.

## Decision

The PR implements a conservative integration: it uses `agent-commander` for execution only when explicitly requested, keeps embedded adapters as the default, and reports missing upstream parity instead of weakening default behavior.

This gives reviewers a working implementation for issue 1043 while keeping the remaining upstream `qwen`/`gemini` parity requirements visible and trackable before `--use-agent-commander` is treated as fully equivalent to the embedded adapters.
