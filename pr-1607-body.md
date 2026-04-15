## Summary

Fixes #1606 by documenting and verifying Playwright MCP registration for Codex in addition to Claude Code.

## Root Cause

The reported environment had `@playwright/mcp` installed and registered in Claude, but `codex mcp list` had no configured servers. Existing docs and helper scripts still focused mainly on Claude setup, so the mismatch was easy to miss even though `/version` already reported it correctly.

## Changes

- added regression coverage for the mixed MCP state where Claude is connected and Codex is not
- updated Playwright MCP verification and integration scripts to check Codex MCP registration explicitly
- updated configuration docs to include both `claude mcp add ...` and `codex mcp add ...`
- added the investigation record and collected evidence under `docs/case-studies/issue-1606`

## Reproduction

1. Install `@playwright/mcp` and register it only with Claude.
2. Run `claude mcp list` and confirm `playwright` is present.
3. Run `codex mcp list` and observe `No MCP servers configured yet`.
4. Run `/version` and observe `Playwright MCP: <version> | Claude Code: connected | Codex: not connected`.

## Verification

- `node tests/test-version-info.mjs`
- `node tests/test-version-parsing.mjs`

## Evidence

- case study: `docs/case-studies/issue-1606/README.md`
- PR: https://github.com/link-assistant/hive-mind/pull/1607
