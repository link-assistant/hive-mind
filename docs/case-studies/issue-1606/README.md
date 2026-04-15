# Issue #1606: Playwright MCP is not connected to Codex

## Overview

Issue: <https://github.com/link-assistant/hive-mind/issues/1606>

Observed behavior from the issue report:

```text
codex mcp list
No MCP servers configured yet. Try `codex mcp add my-tool -- my-command`.
```

At the same time, `/version` showed Playwright MCP installed and connected for Claude Code, but not for Codex:

```text
Playwright MCP: 0.0.69 | Claude Code: connected | Codex: not connected
```

This case study captures the local evidence, reconstructs the likely sequence of events, and documents the fix strategy.

## External References

- Codex MCP command reference: <https://github.com/openai/codex>
- Playwright MCP package: <https://www.npmjs.com/package/@playwright/mcp>

These references support the key conclusion that MCP registration is CLI-specific: installing the package is not enough, and Codex must be configured separately from Claude Code.

## Requirements From The Issue

1. Download and preserve logs and related issue data in the repository.
2. Store the investigation in `docs/case-studies/issue-1606`.
3. Reconstruct the timeline and sequence of events.
4. List all practical requirements implied by the bug.
5. Identify the real root cause for each observed problem.
6. Propose concrete solutions and implementation plans.
7. If the current data is insufficient, add debug or verification output for the next iteration.

## Collected Evidence

- [Issue JSON](./raw/issue.json)
- [PR 1607 JSON](./raw/pr-1607.json)
- [Branch CI runs](./ci-logs/gh-run-list.branch.json)
- [Codex MCP list output](./raw/codex-mcp-list.txt)
- [Claude MCP list output](./raw/claude-mcp-list.txt)
- [Version info snapshot](./raw/version-info.json)
- [Recent CI runs for branch](./ci-logs/gh-run-list.branch.json)

Local reproduction from this workspace on 2026-04-15:

- `@playwright/mcp` is installed globally.
- `claude mcp list` shows the `playwright` server as connected.
- `codex mcp list` shows no configured MCP servers.
- `getVersionInfo()` reports:
  - `playwrightMcp: "@playwright/mcp@0.0.69"`
  - `playwrightMcpClaudeStatus`: populated
  - `playwrightMcpCodexStatus`: `null`

The branch currently has no GitHub Actions runs recorded in [gh-run-list.branch.json](./ci-logs/gh-run-list.branch.json), so there were no non-passing run logs to download for this issue iteration.

## Timeline

1. 2025-09-30: PR #329 added Playwright MCP preconfiguration for Claude CLI.
2. 2026-03-30: PR #1507 expanded `/version` output and browser tooling coverage.
3. 2026-03-31: PR #1515 standardized `/version` formatting, including the inline Playwright MCP status line.
4. 2026-04-15 06:32:39Z: issue #1606 was opened with `codex mcp list` showing no configured servers while `/version` reported `Claude Code: connected | Codex: not connected`.
5. 2026-04-15: local evidence collected in this branch reproduced the same mixed state from this workspace.

Sequence of events:

1. The package `@playwright/mcp` was present in the environment.
2. Claude Code had a user-level MCP registration for `playwright`.
3. Codex had no MCP registration at all.
4. `/version` used separate CLI probes and correctly rendered the split state.
5. Operators still had documentation and helper scripts that were easier to read as “Claude setup” than “configure both CLIs”, so the mismatch remained plausible in practice.

## Root Cause Analysis

### Problem 1: Codex reports Playwright MCP as not connected

Root cause:

- Codex MCP registration is missing in the affected environment.
- This is directly confirmed by [codex-mcp-list.txt](./raw/codex-mcp-list.txt), which contains the Codex CLI message that no MCP servers are configured.

### Problem 2: Installation guidance did not reliably prevent the mismatch

Root cause:

- Documentation and helper scripts still described verification and manual setup primarily in terms of Claude.
- That created a gap between the intended supported state and the validated/documented state.
- The installation state is inherently per-CLI, so any guidance that verifies only Claude is incomplete for Codex users.

### Problem 3: Regression coverage did not explicitly lock the mixed-state scenario

Root cause:

- Existing tests covered “both connected” and “both not connected”, but not the practical failure mode where Claude is connected and Codex is not.

### Problem 4: The issue asked for preserved investigation artifacts

Root cause:

- The repository did not yet contain an issue-specific evidence bundle for this failure at `docs/case-studies/issue-1606`.
- Without a preserved snapshot of `codex mcp list`, `claude mcp list`, and `/version` data, future reviewers would need to reconstruct the same state again from scratch.

## Solution Plan

1. Keep `/version` behavior unchanged because it is already surfacing the mismatch correctly.
2. Add regression coverage for the mixed connection state: Claude connected, Codex not connected.
3. Update verification and installation scripts to check and document Codex MCP registration explicitly.
4. Update configuration docs so the primary installation instructions register Playwright MCP for both Claude and Codex.
5. Preserve this case-study folder as the evidence trail for future regressions.

Practical implementation plan:

1. Add a unit test for the mixed MCP state so message formatting stays correct.
2. Update operator-facing scripts so they fail or warn when Codex registration is missing.
3. Update the configuration guide to state explicitly that Claude Code and Codex maintain separate MCP registrations.
4. Keep raw evidence in the repository for this issue so future regressions can compare the exact observed state.

## Implemented Fix Direction

The code changes associated with this issue update:

- regression tests for mixed MCP status,
- Playwright MCP verification scripts,
- integration/install test scripts,
- configuration documentation.

## Additional Notes

The current evidence is sufficient to explain the reported symptom. No extra runtime debug logging was required to identify the root cause because the CLIs already provide definitive state via `claude mcp list` and `codex mcp list`.
