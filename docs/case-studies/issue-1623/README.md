# Issue #1623: Use Playwright MCP if WebFetch or WebSearch Tools Failed

## Summary

When standard web tools (WebFetch, WebSearch) fail to retrieve content — due to JavaScript-rendered pages, login-protected content, rate limiting, or empty responses — AI solvers should automatically fall back to Playwright MCP browser automation tools for web browsing and internet search.

## Problem Statement

Before this change, Playwright MCP browser automation hints were only included in system prompts for `--tool claude` and `--tool codex`. The `--tool opencode` and `--tool agent` paths had no Playwright MCP fallback guidance, meaning AI solvers using those tools would not know to use browser automation when standard web tools failed.

Additionally, none of the tools included guidance for falling back to Playwright MCP when the **WebSearch** tool fails — only WebFetch was covered.

## Requirements

1. **All tools must include Playwright MCP fallback hints** — claude, codex, opencode, and agent should all have Playwright MCP usage sections in their system prompts.
2. **WebFetch fallback** — When WebFetch fails (empty content, JS-rendered pages, login-protected pages), guidance to use Playwright MCP (browser_navigate, browser_snapshot) as fallback.
3. **WebSearch fallback** — When WebSearch fails or returns insufficient results, guidance to use Playwright MCP as fallback for internet search.
4. **Availability detection** — Each tool should check whether Playwright MCP is actually installed before enabling the hints, to avoid confusing the AI with references to unavailable tools.
5. **Conditional inclusion** — Hints are controlled by the `--prompt-playwright-mcp` flag (default: true) and only included when the MCP server is detected.
6. **Per-session disable** — PR feedback requested `--no-playwright-mcp`, which should physically disable Playwright MCP for the current tool run and cascade to disable `--prompt-playwright-mcp`.
7. **No global side effects** — `--no-playwright-mcp` must not remove or disable global Playwright MCP registration for other concurrent or future agentic tool calls.
8. **All tool paths** — PR feedback explicitly repeated that opencode and agent CLI must be covered, not only Claude and Codex.

## Root Cause Analysis

The original Playwright MCP prompt support (added for issue #1124) was implemented only for Claude and Codex tools because those were the primary tools at the time. As OpenCode and Agent tools were added later, the Playwright MCP integration was not extended to them.

The WebSearch fallback was not included in any tool because the original focus was on WebFetch failures for page content retrieval.

## Solution

### External Facts Checked

- Microsoft's Playwright MCP repository describes it as an MCP server for browser automation using Playwright and documents the standard `mcpServers.playwright` configuration shape for multiple clients, including Claude Code, Codex, and opencode: https://github.com/microsoft/playwright-mcp.
- The Playwright MCP README lists Codex setup through `codex mcp add playwright npx "@playwright/mcp@latest"` or `[mcp_servers.playwright]` in `~/.codex/config.toml`, which matches this project's detection strategy: https://github.com/microsoft/playwright-mcp.
- The OpenAI developers documentation confirms Codex MCP servers are shared between the CLI and IDE extension and can be verified with `codex mcp list`: https://developers.openai.com/learn/docs-mcp.
- Local Codex CLI help confirmed that per-invocation config overrides are supported with `-c key=value`, and local verification confirmed `codex mcp list -c mcp_servers.playwright.enabled=false` marks the server disabled without editing `~/.codex/config.toml`.
- Claude Code help confirms `--mcp-config` and `--strict-mcp-config` are available for session-specific MCP configuration.

### Changes Made

| File                               | Change                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `src/opencode.prompts.lib.mjs`     | Added full Playwright MCP usage section with WebFetch and WebSearch fallback notes |
| `src/agent.prompts.lib.mjs`        | Added full Playwright MCP usage section with WebFetch and WebSearch fallback notes |
| `src/claude.prompts.lib.mjs`       | Added WebSearch fallback note (WebFetch was already present)                       |
| `src/codex.prompts.lib.mjs`        | Added WebSearch fallback note (WebFetch was already present)                       |
| `src/opencode.lib.mjs`             | Added `checkPlaywrightMcpAvailability()` function                                  |
| `src/agent.lib.mjs`                | Added `checkPlaywrightMcpAvailability()` function                                  |
| `src/solve.mjs`                    | Added Playwright MCP availability checks for opencode and agent tool paths         |
| `src/solve.restart-shared.lib.mjs` | Added Playwright MCP availability checks for opencode and agent restart paths      |
| `src/solve.config.lib.mjs`         | Updated config description to list all four supported tools                        |
| `src/playwright-mcp.lib.mjs`       | Added shared MCP helpers and per-session disable behavior                          |

### Availability Detection Strategy

- **Claude**: Uses `claude mcp list` to check if Playwright MCP is registered
- **Codex**: Uses `codex mcp list` to check if Playwright MCP is registered
- **OpenCode**: Checks for `@playwright/mcp` npm package availability (via `npx --no-install` and `npm ls -g`)
- **Agent**: Checks for `@playwright/mcp` npm package availability (same approach as OpenCode)

### Per-Session Disable Strategy

- **Claude**: `--no-playwright-mcp` builds a temporary MCP config without Playwright and launches Claude with `--strict-mcp-config --mcp-config <temp-file>`.
- **Codex**: `--no-playwright-mcp` passes `-c mcp_servers.<playwright-name>.enabled=false` to the current `codex exec` command. This disables Playwright only for that invocation and does not run `codex mcp remove`.
- **OpenCode / Agent**: These paths do not directly attach MCP servers in this codebase, so `--no-playwright-mcp` cascades to `--no-prompt-playwright-mcp`.
- **All tools**: `--no-playwright-mcp` also disables Playwright MCP artifact cleanup because no Playwright MCP artifacts should be created by that session.

## Testing

Test file: `tests/playwright-mcp-prompts.test.mjs`

Run with:

```bash
node tests/playwright-mcp-prompts.test.mjs
```

Tests verify:

- All four prompt files contain Playwright MCP sections
- All four prompt files include WebFetch and WebSearch fallback notes
- All four lib files export `checkPlaywrightMcpAvailability`
- `solve.mjs` and `solve.restart-shared.lib.mjs` check availability for all tools
- Config description mentions all four tools
- Prompt builders produce correct output when flag is enabled/disabled
- `--no-playwright-mcp` cascades related flags and does not mutate global Codex MCP registration

## Related Issues

- Issue #1124: Playwright MCP Auto-Cleanup (original Playwright MCP integration)
- Issue #837: Playwright MCP Chrome Leak
