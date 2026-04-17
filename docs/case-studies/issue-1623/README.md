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

## Root Cause Analysis

The original Playwright MCP prompt support (added for issue #1124) was implemented only for Claude and Codex tools because those were the primary tools at the time. As OpenCode and Agent tools were added later, the Playwright MCP integration was not extended to them.

The WebSearch fallback was not included in any tool because the original focus was on WebFetch failures for page content retrieval.

## Solution

### Changes Made

| File | Change |
|------|--------|
| `src/opencode.prompts.lib.mjs` | Added full Playwright MCP usage section with WebFetch and WebSearch fallback notes |
| `src/agent.prompts.lib.mjs` | Added full Playwright MCP usage section with WebFetch and WebSearch fallback notes |
| `src/claude.prompts.lib.mjs` | Added WebSearch fallback note (WebFetch was already present) |
| `src/codex.prompts.lib.mjs` | Added WebSearch fallback note (WebFetch was already present) |
| `src/opencode.lib.mjs` | Added `checkPlaywrightMcpAvailability()` function |
| `src/agent.lib.mjs` | Added `checkPlaywrightMcpAvailability()` function |
| `src/solve.mjs` | Added Playwright MCP availability checks for opencode and agent tool paths |
| `src/solve.restart-shared.lib.mjs` | Added Playwright MCP availability checks for opencode and agent restart paths |
| `src/solve.config.lib.mjs` | Updated config description to list all four supported tools |

### Availability Detection Strategy

- **Claude**: Uses `claude mcp list` to check if Playwright MCP is registered
- **Codex**: Uses `codex mcp list` to check if Playwright MCP is registered
- **OpenCode**: Checks for `@playwright/mcp` npm package availability (via `npx --no-install` and `npm ls -g`)
- **Agent**: Checks for `@playwright/mcp` npm package availability (same approach as OpenCode)

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

## Related Issues

- Issue #1124: Playwright MCP Auto-Cleanup (original Playwright MCP integration)
- Issue #837: Playwright MCP Chrome Leak
