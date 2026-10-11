# Primary-source research and implementation choices

Sources were checked on 2026-10-08 UTC. Archived vendor files in [data/](data/) are evidence snapshots; their contents have not been reformatted.

## Claude's terminal result contract

The [official TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript) defines a result variant with `subtype: success` and an independent boolean `is_error`. Therefore subtype alone cannot establish application success. The incident exhibits exactly this combination; the relevant type definition is saved in [agent-sdk-result-type.txt](data/agent-sdk-result-type.txt).

The [official Python SDK error implementation](https://github.com/anthropics/claude-agent-sdk-python/blob/f7b0b62c2a8d110d4da0eec0aa70cf795ec3afc4/src/claude_agent_sdk/_errors.py) documents that a completed agent loop can have a final API error. Its terminal-error exception retains the original result, subtype, HTTP status, and session metadata. The [downloaded source](data/agent-sdk-errors.py.txt) corroborates the observed CLI behavior.

[Anthropic issue #41265](https://github.com/anthropics/claude-code/issues/41265), archived in [data/upstream-docs-41265.json](data/upstream-docs-41265.json), already discusses the misleading subtype interpretation and was closed as not planned. A new report alleging that Claude must never emit this combination would contradict its current contract. The actionable defect here belongs to Hive Mind's interpretation, so it is fixed locally without duplicating that upstream discussion.

## Bash exit status and the runtime prerequisite

The [GNU Bash manual](https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html), saved as [bash-exit-status.html](data/bash-exit-status.html), assigns exit 127 to a command that cannot be found. That agrees with the tool's explicit missing-`file` diagnostic. The ordinary commit lines in the same shell output are not the cause of the status.

Box's [runtime Dockerfile](https://github.com/link-foundation/box/blob/ab91865d4f8dddae987e37f4e535858bca42626c/Dockerfile), [essentials Dockerfile](https://github.com/link-foundation/box/blob/ab91865d4f8dddae987e37f4e535858bca42626c/ubuntu/24.04/essentials-box/Dockerfile), and [essentials installer](https://github.com/link-foundation/box/blob/ab91865d4f8dddae987e37f4e535858bca42626c/ubuntu/24.04/essentials-box/install.sh) were inspected and preserved in data. The installer has no explicit `file` dependency. This supports an upstream dependency request but does not replace an isolated historical base-image test; the local reproduction established its absence in the task environment.

[Box #129](https://github.com/link-foundation/box/issues/129) contains that distinction, reproducible commands using a finite container memory limit, the verified non-sudo Homebrew workaround, and a proposed shared dependency/image test. Hive Mind's conditional Homebrew install is a compatible downstream fix until its base images guarantee the prerequisite.

## Existing components and related work

| Component or related PR                                                                                                | What it already solves                                                                                                            | Decision                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/usage-limit.lib.mjs`, `src/tool-retry.lib.mjs`; [PR #1936](https://github.com/link-assistant/hive-mind/pull/1936) | Recognizes session/weekly account limits, extracts reset time/timezone, and separates account limits from temporary throttling    | Reuse the shared detectors and add the terminal machine-code guard. No new parser/library is needed.                                              |
| `src/anthropic-cost-accumulator.lib.mjs`                                                                               | Keeps billed cost even for failed runs and preserves resumed-session accumulation                                                 | Retain it for both stream paths. Its subtype branch chooses a cost source, not execution success; changing it would risk losing billing evidence. |
| [PR #2271](https://github.com/link-assistant/hive-mind/pull/2271), issue #2263                                         | Rejects an actual successful provider envelope after diagnostic-rich failed final verification and keeps failed recovery in draft | Preserve that behavior, while preventing the final tool record from replacing a terminal provider/process error.                                  |
| [PR #2302](https://github.com/link-assistant/hive-mind/pull/2302), `src/claude.print-turn.lib.mjs`                     | Detects unfinished background tasks in a completed print-mode turn and resumes them                                               | Add the same `is_error` guard before considering a turn incomplete.                                                                               |
| [PR #2024](https://github.com/link-assistant/hive-mind/pull/2024)                                                      | Fails and retries streams that never produce a required terminal result                                                           | Keep the missing-result policy; sharing result processing also makes an unterminated result's errors visible.                                     |
| [PR #2172](https://github.com/link-assistant/hive-mind/pull/2172), issue #2169                                         | Prevents false transient retries after actual success and provides bounded retry policy/diagnostics                               | Keep the success gate and add account-limit precedence over stale transient flags.                                                                |
| [PR #2409](https://github.com/link-assistant/hive-mind/pull/2409), existing resource/session-monitor helpers           | Reports killed sessions and resumes them with recovery evidence                                                                   | Keep these separate from the fully evidenced evening provider failure. No guessed memory fix is introduced.                                       |

The related merged PR bodies are archived in [related-prs.json](data/related-prs.json) and the three individual PR snapshots for #2024, #2302, and #2409.

## Whole-codebase audit and alternatives

Searching `src/` for subtype-success checks, structured HTTP 429 classification, terminal-tool overrides, and background-turn assessment identified both Claude parsing paths and the print-turn helper. These are the affected execution decisions. Shared command execution serves direct, resumed, retry, and interactive Claude sessions, so the fix applies at the common entry point.

The Agent wrapper's similarly named completion helper consumes a different CLI event contract. It does not execute the Claude final-tool override or the structured Claude HTTP 429 branch. The archived earlier Agent failures have no provider trace, so this investigation does not infer the Claude defect there. Other tool wrappers use the shared text retry/limit detectors and do not parse Claude's result envelope.

Making every exit 127 tool record benign was rejected: a missing compiler/test dependency can invalidate final verification. Always preferring a failed tool record was also rejected because it destroys a later provider's recovery diagnosis. Preserving explicit terminal errors and using final-tool failure only to veto a real success keeps both guarantees.

Replacing the streaming wrapper with an SDK would be a larger migration involving interactive input, live feedback, process termination, cost tracking, and existing CLI-specific recovery. A shared result handler fixes the demonstrated inconsistency without introducing another runtime dependency.

For uncertain future resource failures, use the existing cgroup snapshots and verbose process records together with kernel/container evidence. The new terminal-result diagnostic prints subtype, error flag, API code, and HTTP status only under `--verbose`; it does not log credentials or expand default output.

## Freshness check discovered during validation

The repository requires exact Docker runtime pins to match current upstream releases. [Node.js 26.11.1](https://github.com/nodejs/node/releases/tag/v26.11.1) was published after the original branch commit; the gate identified the three existing 26.11.0 pins as stale. They are advanced together to 26.11.1. [Release metadata](data/node-release-26.11.1.json) preserves the timestamp. The final freshness check uses authenticated GitHub access to avoid anonymous API rate limiting.
