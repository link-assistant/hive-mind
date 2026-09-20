# Issue #1627: Disable Useless Tools and MCP Servers for Claude Code

## Summary

Claude Code, when used inside hive-mind's autonomous headless workflow on a server without a UI, exposes several built-in tools and MCP servers that provide no value and actively harm the workflow. They waste token budget, can hang the session waiting on a human reaction that never comes, or require account-level authentication/system-wide changes that are not possible in the sandboxed Docker context.

This case study documents the requirements, root causes, and the multi-layer solution (Docker image, solve.mjs runtime) that disables them.

## Problem Statement

When `solve.mjs` launches `claude` inside the `konard/hive-mind` Docker image, the `--verbose` stream emits a `"tools"` list showing many tools and MCP servers that are irrelevant for headless issue-solving runs:

### MCP servers that need authentication (unusable in headless/Docker)

From logs (see `logs/claude-mcp-list.txt`):

```
claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1   ! Needs authentication
claude.ai Google Calendar: https://gcal.mcp.claude.com/mcp       ! Needs authentication
claude.ai Gmail: https://gmail.mcp.claude.com/mcp                ! Needs authentication
```

These three MCP servers are auto-registered by Claude Code when the user signs in with a `claude.ai` OAuth session (Pro/Max plan connectors). They are not part of `claude mcp add` scopes (`user`/`local`/`project`), so `claude mcp remove` cannot be used to delete them. They surface as MCP tool prefixes `mcp__claude_ai_Gmail__*`, `mcp__claude_ai_Google_Drive__*`, `mcp__claude_ai_Google_Calendar__*` but always report `needs-auth` because there is no interactive browser step available inside a Docker sandbox.

### Built-in Claude Code tools with no value in autonomous headless mode

From Claude Code's own self-description (see the issue body):

- **Planning & Tracking**
  - `EnterPlanMode` / `ExitPlanMode` — read-only mode requiring user approval to enter/exit (blocks autonomous runs).
  - `EnterWorktree` / `ExitWorktree` — creates a git worktree under `.claude/worktrees/`; only used when "worktree" is explicitly mentioned.
  - `AskUserQuestion` — blocking multiple-choice prompt (requires a human to click).
- **Scheduling & Automation**
  - `ScheduleWakeup` — self-paced `/loop` only; dies with session.
  - `CronCreate` / `CronList` / `CronDelete` — local session cron jobs (auto-expire after 7 days, session-scoped).
  - `RemoteTrigger` — remote-agent trigger wrapper.
  - `PushNotification` — desktop/mobile notification.

Keeping these tools enabled:

1. **Wastes token budget** — every tool schema is sent on every request.
2. **Risks hangs** — `AskUserQuestion` waits for a human who will never arrive.
3. **Makes the system unpredictable** — `EnterPlanMode` can block the session until a plan is approved.
4. **Has side effects** — `CronCreate` persists session cron jobs; `EnterWorktree` creates untracked `.claude/worktrees/` dirs.
5. **Doesn't work at all** — `claude.ai` connectors report `needs-auth` forever.

## Requirements (extracted from the issue body)

1. **Disable the three `claude.ai` MCP servers** (Gmail, Google Calendar, Google Drive) — they can never be authenticated inside a headless Docker container.
2. **Disable the following built-in Claude Code tools**: `AskUserQuestion`, `CronCreate`, `CronDelete`, `CronList`, `EnterPlanMode`, `EnterWorktree`, `ExitPlanMode`, `ExitWorktree`, `Monitor`, `NotebookEdit`, `PushNotification`, `RemoteTrigger`, `ScheduleWakeup`. (Keep the rest of the tool list unchanged.)
3. **Disable at two layers, preferring both**:
   - **Docker image-build time** — install hook that ensures the useless MCPs and tools are disabled in the baseline image (for users running interactive Claude Code sessions without `solve.mjs`).
   - **`solve` command runtime** — every `solve`/`hive` run must verify they are disabled and, if they somehow got re-enabled, disable them automatically before invoking `claude`.
4. **Do not disable them globally in a destructive way** — user-invoked interactive `claude` sessions outside of hive-mind should still work unchanged. Disabling must be per-session or cleanly reversible.
5. **Download and persist relevant logs** into `docs/case-studies/issue-1627/` (this folder).
6. **If the bug lies in another project**, file an issue upstream with a reproducible example, workaround, and suggested fix.

## Timeline

| Timestamp (UTC)          | Event                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-04-17T17:58:56.441Z | User runs `solve`; verbose logs show `tools` array containing all useless tools and `needs-auth` MCP servers.          |
| 2026-04-17               | Issue #1627 filed with the full list to disable.                                                                       |
| 2026-04-17               | PR #1628 opened by AI issue solver for this branch.                                                                    |
| 2026-04-17               | Case study and implementation landed: new `useless-tools.lib.mjs`, `--useless-tools-disabled` flag, Docker image hook. |

## Root Cause Analysis

### Why the `claude.ai` MCPs show up

Claude Code 2.x (pinned in `konard/sandbox` -> `@anthropic-ai/claude-code`) auto-registers `claude.ai Gmail`, `claude.ai Google Calendar`, and `claude.ai Google Drive` as HTTP MCP servers for Pro/Max plan users whose Claude account has those connectors enabled. They live in the user's `~/.claude/` OAuth state, not in `~/.claude.json`'s `mcpServers` map — so the existing `buildMcpConfigWithoutPlaywright(...)` helper (which reads `~/.claude.json`) never sees them. They can be filtered out with `--strict-mcp-config --mcp-config <file>` where `<file>` is a curated JSON that excludes them.

### Why the built-in tools are enabled

Claude Code CLI ships with every built-in tool enabled unless the user passes `--disallowedTools` (or configures `disallowedTools` in settings). There is no default-safe list for headless sandboxed use, so the hive-mind project has to supply one.

## Solution

### External Facts Checked

- `claude --help` locally confirms `--disallowedTools, --disallowed-tools <tools...>` accepts a space/comma-separated list of tool names, and `--strict-mcp-config` + `--mcp-config <file>` scope MCP servers to a single JSON.
- `claude mcp list` returns the three `claude.ai Gmail/Google Drive/Google Calendar` servers but `claude mcp remove "claude.ai Gmail"` reports `No MCP server found with name: "claude.ai Gmail"` because they are not registered under `user`/`local`/`project` scope. They must be filtered, not removed.
- Anthropic documentation for Claude Code settings (as of Claude Code 2.x) documents `disallowedTools` as an array of tool-name strings in `~/.claude/settings.json`, which we use in the Docker image baseline.
- The existing `src/playwright-mcp.lib.mjs` uses `--strict-mcp-config --mcp-config <tempfile>` for the same class of problem (filtering out one MCP server without touching global config). This pattern is reused here.

### Design

A new helper module `src/useless-tools.lib.mjs` owns:

1. A static list of **built-in Claude Code tools** that are always disabled in hive-mind runs (`AskUserQuestion`, `Cron*`, `Enter*/ExitPlanMode`, `Enter*/ExitWorktree`, `Monitor`, `NotebookEdit`, `PushNotification`, `RemoteTrigger`, `ScheduleWakeup`).
2. A static list of **MCP server name prefixes** that are always disabled in hive-mind runs (`claude.ai Gmail`, `claude.ai Google Drive`, `claude.ai Google Calendar`).
3. `buildFilteredMcpConfig(log)` — writes a temp JSON containing only the allowed MCP servers from `~/.claude.json` + the full set of registered `claude mcp list` entries that are not on the blocklist.
4. `buildDisallowedToolsArg()` — returns the formatted CLI argument(s) for `--disallowedTools`.
5. `ensureSettingsDisableList({ scope: 'user' })` — persists the `disallowedTools` list in `~/.claude/settings.json` so even interactive `claude` runs outside `solve` don't expose the useless tools.

`src/claude.lib.mjs`:

- Wraps the existing `--strict-mcp-config --mcp-config` injection so both the Playwright MCP filter and the useless-MCP filter merge into the same temp file.
- Adds `--disallowedTools <list>` to the `claude` command line when `argv.uselessToolsDisabled !== false`.

`src/solve.config.lib.mjs` gets a new option:

```
'useless-tools-disabled': {
  type: 'boolean',
  description: 'Disable Claude Code tools and MCP servers that have no value in autonomous headless runs (CronCreate, EnterPlanMode, RemoteTrigger, claude.ai Gmail/Drive/Calendar, …). Default: true. Use --no-useless-tools-disabled to keep them enabled.',
  default: true,
}
```

`Dockerfile` (and `coolify/Dockerfile`): a build step writes a baseline `~/.claude/settings.json` `disallowedTools` entry. We also keep a comment explaining that the `claude.ai Gmail/Drive/Calendar` connectors cannot be removed at build time — only filtered at run time — because they re-appear whenever the user's OAuth session includes them.

### Trade-offs considered

- **`--tools <tools...>` allow-list** vs. **`--disallowedTools <tools...>` block-list.** An allow-list is more robust (new future useless tools are blocked automatically), but enumerating every future-useful tool requires tracking upstream Claude Code releases. A block-list is fragile to renames but matches the exact requirement in the issue ("disable only what I listed before that"). We implement block-list behavior and document future maintenance.
- **Remove from `claude mcp`** vs. **filter with `--mcp-config`.** `claude mcp remove` does not find the `claude.ai …` servers (verified locally). Filtering is the only reliable mechanism.
- **Global `~/.claude/settings.json`** vs. **per-run CLI args.** We do both: image-level settings cover interactive users; per-run flags cover automated runs and provide a tested fail-safe.

## Solution Plan (implementation steps)

1. Add `src/useless-tools.lib.mjs` with the lists and helpers.
2. Update `src/claude.lib.mjs` to call the helper and inject `--disallowedTools` + merged `--mcp-config`.
3. Add `useless-tools-disabled` option (default `true`) to `src/solve.config.lib.mjs`.
4. Update `Dockerfile` to bake `disallowedTools` into `~/.claude/settings.json` during image build.
5. Update `coolify/Dockerfile` identically.
6. Add unit tests in `tests/useless-tools.test.mjs`.
7. Update `docs/CONFIGURATION.md` to document the flag.
8. Add changeset under `.changeset/`.

## Upstream issue

The three `claude.ai Gmail/Drive/Calendar` MCP servers report `needs-auth` indefinitely inside headless Docker because there is no interactive browser available to complete the OAuth step, yet they are still sent as tools on every request. A follow-up issue upstream to Anthropic's Claude Code repo is appropriate: these connectors should be silently pruned (or marked with a `disabledInHeadless: true` flag) when the runtime detects `--print` / `--dangerously-skip-permissions` with no TTY. We link to this case study in that upstream issue when filed.

## Files

- `issue.json` — raw issue data
- `issue-comments.json` — raw issue comments (empty at time of writing)
- `logs/claude-mcp-list.txt` — raw `claude mcp list` output showing `needs-auth` for the three `claude.ai` connectors
- `logs/mcp-needs-auth-cache.json` — Claude Code's internal auth-needed cache showing the same three connectors

## Related Issues

- Issue #1623 — Playwright MCP fallback for WebFetch/WebSearch (shared MCP-filtering infrastructure).
- Issue #1124 — Playwright MCP auto-cleanup (original `--strict-mcp-config --mcp-config` pattern).
