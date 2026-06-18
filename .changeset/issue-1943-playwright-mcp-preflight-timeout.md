---
'@link-assistant/hive-mind': patch
---

fix(playwright-mcp): do not abort the solve when the Playwright MCP preflight probe is inconclusive (#1943)

A `solve` run aborted before creating a pull request with
`❌ Playwright MCP preflight failed for Claude Code`. The local preflight ran
`timeout 5 claude mcp list`, but that command performs a live health check that
launches a browser and can take longer than five seconds; when the `timeout`
killed the probe, `ensureConnectedPlaywrightMcpServer` treated the non-zero exit
as a failure and stopped the whole run.

An inconclusive `mcp list` probe (timeout / crash / missing CLI) now falls back
to the local `@playwright/mcp` package check instead of aborting: if the package
is installed, the server connects on demand via Tool Search (issue #1901), so the
working session proceeds. The probe timeout now defaults to 30s and is overridable
via `PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS`, and the preflight emits verbose
diagnostics (probe exit code, matched rows, decision branch) so failures are
diagnosable from the log. The preflight still fails only when `@playwright/mcp`
is genuinely unavailable.
