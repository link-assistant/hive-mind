## Summary

Fixes #1606 by documenting and verifying Playwright MCP registration for Codex in addition to Claude Code, including the Docker-specific case where persisted Codex state overrides the image defaults.

## Root Cause

The reported environment had `@playwright/mcp` installed and registered in Claude, but `codex mcp list` had no configured servers. The immediate cause was missing Codex MCP registration. Local reproduction confirmed that `/workspace/.codex/config.toml` can exist without a Playwright MCP entry and that `codex mcp add playwright ...` fixes the state immediately. In Docker deployments, the most likely explanation is that a host-mounted `/workspace/.codex` directory preserved an older Codex config and replaced the image-baked MCP registration. Existing docs and helper scripts also focused mainly on Claude setup, so the mismatch was easy to miss even though `/version` already reported it correctly.

## Changes

- added regression coverage for the mixed MCP state where Claude is connected and Codex is not
- updated Playwright MCP verification and integration scripts to check Codex MCP registration explicitly
- updated Docker verification to fail if Claude or Codex is missing the Playwright MCP registration
- updated configuration and Docker docs to include both `claude mcp add ...` and `codex mcp add ...`
- documented that mounting `/workspace/.codex` can override the image defaults and reintroduce the problem
- added the investigation record and collected evidence under `docs/case-studies/issue-1606`

## Reproduction

1. Install `@playwright/mcp` and register it only with Claude.
2. Run `claude mcp list` and confirm `playwright` is present.
3. Run `codex mcp list` and observe `No MCP servers configured yet`.
4. Run `/version` and observe `Playwright MCP: <version> | Claude Code: connected | Codex: not connected`.

## Verification

- `node tests/test-version-info.mjs`
- `node tests/test-version-parsing.mjs`
- `bash scripts/verify-docker-image.sh`

## Evidence

- case study: `docs/case-studies/issue-1606/README.md`
- PR: https://github.com/link-assistant/hive-mind/pull/1607
