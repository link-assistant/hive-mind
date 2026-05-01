# Issue 1043: Optional agent-commander Execution

## Scope

Issue: https://github.com/link-assistant/hive-mind/issues/1043

Pull request: https://github.com/link-assistant/hive-mind/pull/1044

The request is to add an experimental `--use-agent-commander` option. When it is not set, hive-mind must keep using the existing embedded tool adapters. When it is set, tool execution for `claude`, `codex`, `opencode`, and `agent` should go through `agent-commander`.

## Evidence

Raw evidence collected for this case study is in `data/`:

- `issue-1043.json`: issue title, body, and comments.
- `pr-1044.json`, `pr-1044-comments.json`, `pr-1044-review-comments.json`, `pr-1044-reviews.json`: PR state and feedback.
- `agent-commander-npm-0.4.3.json`: npm package metadata.
- `agent-commander-release-js-0.4.3.json`: GitHub release metadata.
- `agent-commander-tools-files.json`: upstream tool implementation files.
- `agent-commander-related-issues.json`: related upstream issues.
- `agent-commander-issue-29.json`, `agent-commander-issue-30.json`: upstream issues opened for missing parity.
- `online-sources.md`: online sources checked.

Online sources checked:

- https://www.npmjs.com/package/agent-commander
- https://github.com/link-assistant/agent-commander
- https://github.com/link-assistant/agent-commander/releases/tag/js_0.4.3

`agent-commander@0.4.3` was published in release `js_0.4.3` on 2026-05-01T04:49:29Z. The release adds prompt-file support and routes large stdin-based prompts through temporary prompt files, which directly matters for hive-mind's generated prompts.

## Requirements

- Add a `--use-agent-commander` CLI option.
- Keep the option experimental and disabled by default.
- Preserve all existing behavior when the option is not selected.
- Make `hive` pass the option to `solve` workers.
- When selected, route all supported tool execution through `agent-commander`.
- Cover `claude`, `codex`, `opencode`, and `agent`.
- Validate that the latest `agent-commander` package can build the selected tool command.
- Keep watch and auto-restart iterations on the same execution path.
- Document missing upstream features and open issues in `link-assistant/agent-commander` where needed.

## Implementation

The option lives in `SOLVE_OPTION_DEFINITIONS` as hidden, boolean, and default `false`. `hive` already registers and forwards solve passthrough options from that shared map, so no duplicate hive option wiring is needed.

Default behavior is preserved by guarding every `agent-commander` path behind `argv.useAgentCommander`. The existing embedded branches in `solve.mjs` and `solve.restart-shared.lib.mjs` still handle `claude`, `codex`, `opencode`, and `agent` when the flag is absent.

The new adapter in `src/agent-commander.lib.mjs` centralizes:

- supported tool validation
- `agent-commander` availability checks
- dry-run connection validation
- prompt construction through the existing per-tool prompt modules
- Playwright MCP prompt availability gating
- result normalization back into the shape expected by solve post-processing
- generic uncommitted-change detection for the agent-commander execution path

## Compatibility Matrix

| Hive-mind feature                                            | agent-commander 0.4.3 status | PR handling                                                                  |
| ------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------- |
| Basic tool launch for `claude`, `codex`, `opencode`, `agent` | Supported                    | Routed through `agent()` when `--use-agent-commander` is set                 |
| Model selection                                              | Supported                    | Passed as `model`                                                            |
| Resume/session id                                            | Partially supported by tool  | Passed as `resume`; upstream parity tracked                                  |
| Large generated prompts                                      | Supported in 0.4.3           | Uses prompt/systemPrompt API, benefiting from upstream prompt-file handling  |
| Claude fallback model                                        | Supported                    | Passed via `toolOptions.fallbackModel`                                       |
| Claude verbose flag                                          | Supported                    | Passed via `toolOptions.verbose`                                             |
| JSON result capture                                          | Partially supported          | Adapter normalizes `output.plain`, `output.parsed`, `sessionId`, and `usage` |
| Playwright MCP prompt hints                                  | Hive-mind-specific           | Adapter reuses existing availability checks and toggles prompt hints         |
| Thinking budget / context window / sub-session sizing        | Missing parity               | Reported upstream in agent-commander issue 29                                |
| Tool-specific MCP config and permission config parity        | Missing parity               | Reported upstream in agent-commander issue 29                                |
| Normalized cost, usage, usage-limit, and summary metadata    | Missing full parity          | Reported upstream in agent-commander issue 30                                |

## Upstream Issues

- https://github.com/link-assistant/agent-commander/issues/29: execution parity options for `claude`, `codex`, `opencode`, and `agent`.
- https://github.com/link-assistant/agent-commander/issues/30: normalized result metadata for hive-mind solve sessions.

There was an older generic sync issue, https://github.com/link-assistant/agent-commander/issues/27, but it was already closed. The new issues are narrower and actionable for the gaps found while updating this PR.

## Decision

The PR implements a conservative integration now: it uses `agent-commander` for execution only when explicitly requested, keeps embedded adapters as the default, and reports missing upstream parity instead of weakening default behavior.

This gives reviewers a working draft for issue 1043 while making the remaining upstream requirements visible and trackable before `--use-agent-commander` is treated as fully equivalent to the embedded adapters.
