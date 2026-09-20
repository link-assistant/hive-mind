# Case Study: Playwright MCP reported as pending (#1901)

## Summary

Issue #1901 was filed after a Hive Mind run on
`lefinepro/kefine#173` started a Claude Code session whose interactive
comment showed:

- `MCP Servers`: `playwright` `(pending)`
- available tools: no `mcp__playwright__*` browser tools

Hive Mind had two local gaps:

1. `checkPlaywrightMcpAvailability()` treated any `claude mcp list` or
   `codex mcp list` output containing the string `playwright` as available.
   That conflated registration with connected tool access.
2. `interactive-mode.lib.mjs` displayed `(pending)` without explaining that
   MCP browser tools were unavailable, so the PR comment looked like a usable
   Playwright MCP setup rather than a startup/connection problem.

This PR fixes both gaps. Pending/failed MCP list rows no longer enable
browser automation hints (the local `claude mcp list` / `codex mcp list`
preflight is a synchronous connectivity probe), and `system.init` comments now
render a still-connecting Playwright server as
`pending - connecting; tools load on demand via Tool Search` instead of looking
like a finished, usable setup. A human-facing diagnostic is added only when the
server status is a terminal `failed`/`error` — never for a transient `pending`.

Follow-up review on PR #1907 pointed out that the Docker images are expected to
ship working Playwright MCP and Playwright CLI fallback, and that persisted
`/home/box/.codex` mounts can hide image-baked Codex MCP config. This PR now
also hardens image verification: Docker builds and `verify-docker-image.sh`
check the Playwright CLI, the local `@playwright/mcp` package, and healthy
Claude/Codex MCP list rows instead of accepting any row containing
`playwright`. Runtime Claude/Codex preflight also restores the default
Playwright MCP registration when it is completely missing and the MCP package
is installed.

A 2026-06-15 follow-up log raised a further question: the local Claude preflight
reported Playwright MCP as connected, but the actual Claude Code process was
started with a filtered `--strict-mcp-config --mcp-config ...` file and its
`system.init` event reported `playwright` as `pending` with no
`mcp__playwright__*` browser tools. PR #1932 initially treated that as a hard
failure that aborted the working session.

A 2026-06-16 review asked us to double-check whether `pending` actually means
"will never connect" (a real failure) or "still connecting; tools arrive via
Tool Search" (fine). **The answer is the latter.** The same `system.init` event
also exposed Claude Code's `ToolSearch` tool and reported `total_deferred_tools`
in its tool-search results, which is the signature of Tool Search: MCP tools are
deferred and load on demand, and Claude waits for a still-connecting server
before it uses one of that server's tools. A `pending` MCP server is therefore a
normal, transient startup state — **not** a failure — so Hive Mind no longer
aborts the session on it. Only a terminal `failed`/`error` status (after Claude
Code exhausts its reconnect attempts) is treated as genuinely unavailable, and
even then only as a visible diagnostic in the session-start comment. The
previous hard-fail (`getPlaywrightMcpSessionInitFailure` plus the
session-aborting branch in `src/claude.lib.mjs`) was removed.

The linked `kefine#173` E2E failures had a separate root cause: stale
Playwright specs after UI changes in `kefine#174` and `kefine#175`. That
external PR was ultimately made green by updating those specs on commit
`b020bd3`; the logs show no evidence that MCP browser tools were available in
the Claude sessions.

## Required Artifacts

All downloaded issue, PR, comment, AI-session, and CI artifacts are kept under
this directory:

| Path                                                         | Purpose                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `data/raw/hive-mind-issue-1901.json`                         | Source issue metadata and body                                           |
| `data/raw/hive-mind-issue-1901-comments-2026-06-15.json`     | Follow-up issue comments that linked the new pending-session gist        |
| `data/raw/hive-mind-pr-1907.json`                            | Prepared Hive Mind PR metadata                                           |
| `data/raw/hive-mind-pr-1932*.json`                           | Current follow-up PR metadata, comments, reviews, and run list           |
| `data/raw/kefine-issue-172.json`                             | External issue linked by `kefine#173`                                    |
| `data/raw/kefine-pr-173.json`                                | External PR metadata                                                     |
| `data/raw/kefine-pr-173-issue-comments.json`                 | External PR conversation comments, including `system.init` comments      |
| `data/raw/kefine-issue-172-run-list.json`                    | Recent GitHub Actions runs for the external branch                       |
| `data/raw/kefine-pr-174.json`                                | Related frontend PR metadata                                             |
| `data/raw/kefine-pr-175.json`                                | Related frontend PR metadata                                             |
| `data/raw/deploy-gist-67532e7a7090462a618ca86fc00d06a6.txt`  | Deployment script referenced by PR review feedback                       |
| `data/external-logs/solution-draft-log-pr-1781180008338.txt` | First AI session log                                                     |
| `data/external-logs/auto-restart-log-pr-1781183077272.txt`   | Auto-restart AI session log                                              |
| `data/external-logs/start-command-log-2026-06-15.txt`        | Follow-up solve log where preflight passed but `system.init` was pending |
| `data/ci-logs/*.log`                                         | Downloaded GitHub Actions logs from passing and failing external runs    |

No screenshots were present in the issue or linked PR comments.

## Timeline

| Time (UTC)             | Event                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-11 10:34:20    | `lefinepro/kefine#173` opened from branch `issue-172-89c7bbd53971`.                                                                                                                                                                                                        |
| 2026-06-11 10:34:34    | First interactive session comment (`4679640744`) showed `playwright` as `pending` and no `mcp__playwright__*` tools. The same raw event is visible in `solution-draft-log-pr-1781180008338.txt` around line 669.                                                           |
| 2026-06-11 11:17-11:21 | External PR #174/release CI showed E2E failures such as missing compare-button/modal expectations. Example: `kefine-pr174-ci-27342994477-failure.log` lines 589-896 and `kefine-release-ci-27343025495-failure.log` lines 2369-2676.                                       |
| 2026-06-11 12:04       | External PR #175 CI showed E2E failures for removed or changed UI elements, including `[data-part="open-solvers"]`, `kefine-task-document-description`, and `/@api/order-1` URL expectations. See `kefine-pr175-ci-27345064569-failure.log` lines 5611-5816.               |
| 2026-06-11 12:13:50    | Auto-restart session comment (`4680396501`) again showed `playwright` as `pending` with no Playwright MCP tools.                                                                                                                                                           |
| 2026-06-11 12:15       | External PR #173 CI failed on commit `505d7c7`; `kefine-ci-27346030359-failure.log` shows 16 E2E failures at lines 1904-1923.                                                                                                                                              |
| 2026-06-11 12:37:48    | External PR #173 CI and Lighthouse runs started on `b020bd3`; both completed successfully.                                                                                                                                                                                 |
| 2026-06-11 13:04:21    | External final summary comment (`4680853216`) stated local `CI=1 playwright test` passed with 129 tests and all 8 checks were green on `b020bd3`. The auto-restart log contains the same result around line 100673.                                                        |
| 2026-06-11 17:27:10    | PR #1907 review feedback requested checking the Hive Mind Docker/DinD image and deployment script because Playwright MCP and the Playwright CLI fallback should be accessible in all images.                                                                               |
| 2026-06-11 22:28+      | Local container verification showed `codex mcp list` with Playwright `enabled`, `claude mcp list` with Playwright `Connected`, `playwright --version` returning `1.60.0`, and `npx --no-install @playwright/mcp --help` exposing server options.                           |
| 2026-06-15 12:41:07    | A follow-up `solve` run started with `--tool claude --attach-logs --verbose --no-tool-check`; `start-command-log-2026-06-15.txt` lines 45-49 show the local Claude Playwright MCP preflight passed.                                                                        |
| 2026-06-15 12:41:38    | The actual Claude command then used a filtered strict MCP config (`--strict-mcp-config --mcp-config`, lines 280-285). Its `system.init` event reported `playwright` as `pending` and exposed no `mcp__playwright__*` tools (lines 586-616).                                |
| 2026-06-15 17:05:19    | The follow-up issue comment asked PR #1932 to explain why Playwright MCP was still pending and fix the failure if needed.                                                                                                                                                  |
| 2026-06-16             | A PR #1932 review asked to re-verify whether `pending` is a real failure or just Tool Search deferral. Re-analysis confirmed the latter (`ToolSearch` + `total_deferred_tools` in the same log, and the latest Claude Code docs), so the in-session hard-fail was removed. |

## External CI Run Summary

| Run ID        | Workflow      | Conclusion | Created             | SHA       |
| ------------- | ------------- | ---------- | ------------------- | --------- |
| `27340855525` | CI            | success    | 2026-06-11 10:34:24 | `615c961` |
| `27340855501` | Lighthouse CI | success    | 2026-06-11 10:34:24 | `615c961` |
| `27342560296` | CI            | success    | 2026-06-11 11:08:10 | `ddc01d1` |
| `27342560288` | Lighthouse CI | success    | 2026-06-11 11:08:10 | `ddc01d1` |
| `27346009559` | CI            | failure    | 2026-06-11 12:14:53 | `ac56dab` |
| `27346009553` | Lighthouse CI | success    | 2026-06-11 12:14:53 | `ac56dab` |
| `27346030359` | CI            | failure    | 2026-06-11 12:15:16 | `505d7c7` |
| `27346030375` | Lighthouse CI | success    | 2026-06-11 12:15:16 | `505d7c7` |
| `27347269440` | CI            | success    | 2026-06-11 12:37:48 | `b020bd3` |
| `27347269444` | Lighthouse CI | success    | 2026-06-11 12:37:48 | `b020bd3` |

## Requirements Inferred From The Issue

- A Hive Mind run must not tell the AI that Playwright MCP browser automation
  is available when the local `mcp list` preflight cannot confirm a connected
  server.
- The PR comment created from `system.init` must accurately describe the MCP
  state: a still-connecting (`pending`) server whose tools load on demand via
  Tool Search must not be reported as a failure, and a genuinely terminal
  (`failed`/`error`) server must be surfaced for humans reviewing the run.
- Hive Mind must not abort a working session merely because a server is
  `pending` at `system.init`, because Tool Search resolves the deferred MCP
  tools and Claude waits for the connecting server before using them.
- The investigation must preserve linked logs and CI artifacts locally.
- The linked external PR's CI failures must be understood, but only Hive Mind
  code should be changed in this repository.

## Root Causes

### Hive Mind local root cause

`src/claude.lib.mjs` and `src/codex.lib.mjs` used a string-presence check:

```js
output.toLowerCase().includes('playwright');
```

That is not a connection check. It returns true for examples like:

```text
playwright: npx @playwright/mcp@latest - pending
```

In `src/interactive-mode.lib.mjs`, the `system.init` comment rendered
`playwright (pending)` exactly as received, but did not explain that no MCP
browser tools were exposed. In the linked external comments, the raw JSON
included `mcp_servers: [{ name: "playwright", status: "pending" }]`, while
the `tools` list had only built-in Claude tools such as `Bash`, `Read`,
`WebFetch`, and `WebSearch`.

### Follow-up strict-session root cause

The 2026-06-15 log demonstrated that a successful local preflight is necessary
but not sufficient. Hive Mind ran `claude mcp list` before the work session and
received a connected Playwright row. Later, `src/useless-tools.lib.mjs` created
a filtered MCP config for the Claude process and `src/claude.lib.mjs` launched
Claude with `--strict-mcp-config --mcp-config`.

That actual Claude session initialized with:

```json
{
  "tools": ["Task", "Bash", "ToolSearch", "WebFetch", "WebSearch"],
  "mcp_servers": [{ "name": "playwright", "status": "pending" }]
}
```

At first glance this looked like the session could not use Playwright MCP even
though the earlier preflight passed. The 2026-06-16 re-analysis corrected that:
the same `system.init` event also listed Claude Code's `ToolSearch` tool, and
later tool-search calls in the same log returned `"total_deferred_tools": 32`.
That is Tool Search in action — deferred MCP tools are intentionally absent from
the `tools` array and load on demand. The `pending` status simply meant the
Playwright MCP client had not finished connecting at the instant of `init`; the
`mcp__playwright__*` tools would have become available through Tool Search when
needed, and Claude waits for a still-connecting server before invoking one of
its tools. So this is **not** a failure, and the working session correctly
continues.

This exact behavior is reproducible in any current Claude Code session that has
Playwright MCP configured: the session starts with `playwright` reported as
connecting (the harness shows it as "still connecting"), and the
`mcp__playwright__browser_*` tools then appear as deferred Tool Search tools a
moment later.

The same log also contains unrelated downstream errors. A missing `file`
command caused one attachment inspection command to exit 127, and the tail of
the run repeatedly hit `GraphQL: Could not resolve to a Repository with the
name 'uselessgoddess/ultimate'`. Those errors happened after the MCP mismatch
and do not explain the initial pending Playwright state.

### External PR root cause

The failing external E2E checks were not caused by missing Playwright MCP
tools. The final external investigation found the same UI test groups failing
on the `release` branch head (`beb57be`). The failures came from stale specs
after two frontend PRs:

- `kefine#174`: disabled compare-solvers UI and tightened the stop-button
  condition.
- `kefine#175`: removed `Open solver list`, removed task-document
  description text, and changed history row navigation semantics.

Commit `b020bd3` updated six stale spec files and produced green CI.

## Online Facts Checked

- Claude Code's MCP documentation states that Tool Search is enabled by default
  and that MCP tool definitions are deferred and loaded on demand, so they are
  intentionally absent from the initial tool list. This is why a `pending`
  Playwright server still yields `mcp__playwright__*` tools when they are needed:
  <https://code.claude.com/docs/en/mcp>
- The Claude Tool Search Tool documentation describes how deferred tools are
  surfaced on demand and reports a `total_deferred_tools` count — the exact
  signature observed in the 2026-06-15 session log:
  <https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool>
- The Model Context Protocol documentation describes MCP as an open standard
  for connecting AI applications to external systems, including tools:
  <https://modelcontextprotocol.io/docs/getting-started/intro>
- Playwright's official MCP documentation says Playwright MCP provides browser
  automation through MCP and that connected assistants use Playwright MCP
  tools to open the browser, navigate, and interact through accessibility
  snapshots:
  <https://playwright.dev/docs/getting-started-mcp>
- The official Playwright MCP repository documents the standard server
  configuration and Claude Code registration command:
  <https://github.com/microsoft/playwright-mcp>
- OpenAI Codex configuration supports MCP server configuration and enabling or
  disabling a configured MCP server with `mcp_servers.<id>.enabled`:
  <https://developers.openai.com/codex/config-reference>
- Playwright's own test docs recommend auto-waiting and auto-retrying
  assertions for browser checks. That supports the external conclusion that
  the failing checks were stale UI expectations rather than an MCP-specific
  browser runtime issue:
  <https://playwright.dev/docs/actionability>

## Existing Components And Libraries

| Component                                             | Role before this PR                                  | Change                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/playwright-mcp.lib.mjs`                          | Shared Playwright MCP utilities and disable helpers  | Adds `hasConnectedPlaywrightMcpServer()` and row extraction helpers                                                 |
| `src/claude.lib.mjs`                                  | Claude execution and Playwright MCP prompt preflight | Uses the shared preflight parser; no longer aborts the session on a `pending` `system.init` state                   |
| `src/codex.lib.mjs`                                   | Codex execution and Playwright MCP prompt preflight  | Uses the shared parser instead of substring matching                                                                |
| `src/version-info.lib.mjs`                            | `/version` browser automation status rendering       | Uses the shared parser so pending rows render as not connected                                                      |
| `src/interactive-mcp-status.lib.mjs`                  | New shared interactive status helpers                | Distinguishes connecting (`pending`) from terminal (`failed`) status; emits a diagnostic only for terminal failures |
| `src/interactive-mode.lib.mjs`                        | Renders `system.init` PR comments                    | Shows `pending` as connecting via Tool Search and warns only on terminal failures                                   |
| `Dockerfile`, `Dockerfile.dind`, `coolify/Dockerfile` | Docker image build contracts                         | Verify Playwright CLI fallback, local MCP package availability, and healthy MCP rows                                |
| `scripts/verify-docker-image.sh`                      | Runtime image verification in CI                     | Rejects pending/unavailable Claude/Codex Playwright rows and checks MCP package access                              |
| `tests/test-issue-1901-playwright-mcp-pending.mjs`    | New regression coverage                              | Reproduces the pending-list-row and pending-system-init cases                                                       |

## Solution

1. Add a shared parser in `playwright-mcp.lib.mjs` that extracts Playwright
   MCP list rows and rejects rows containing pending, disabled, failed,
   disconnected, timeout, or not-connected statuses.
2. Change Claude and Codex preflight checks to use that parser.
3. Add interactive MCP status helpers that:
   - render a still-connecting server as
     `pending - connecting; tools load on demand via Tool Search` and a terminal
     one as `failed - MCP tools unavailable`;
   - emit a Playwright-specific diagnostic only when the status is terminal
     (`failed`/`error`) and no `mcp__playwright__*` tools are present — never for
     a transient `pending`;
   - include that diagnostic in the session-start comment.
4. Restore the default Claude/Codex Playwright MCP registration only when it is
   completely absent and the local MCP package is available. This repairs the
   common Docker case where a persisted `/home/box/.codex` mount overrides the
   image-baked config.
5. Harden Docker build/runtime verification so CI fails on pending/unavailable
   MCP status and on missing Playwright CLI or `@playwright/mcp` fallback.
6. Do **not** fail the working session on a `pending` `system.init` state. The
   2026-06-16 re-analysis confirmed `pending` is the normal still-connecting
   state and that the deferred `mcp__playwright__*` tools load on demand via Tool
   Search, so the earlier hard-fail guard was removed. Only a terminal
   `failed`/`error` status surfaces a non-blocking diagnostic.
7. Add focused default-suite regression tests for issue #1901, including a guard
   that `src/claude.lib.mjs` does not reintroduce a pending hard-fail.

## Reproduction Test

The regression test first models the old false positive:

```text
playwright: npx @playwright/mcp@latest - pending
```

The previous code would enable prompt hints because the output contained
`playwright`. The new test asserts that this is not connected.

The test also feeds an interactive `system.init` event with:

```json
{
  "tools": ["Task", "Bash", "Read"],
  "mcp_servers": [{ "name": "playwright", "status": "pending" }]
}
```

The expected comment now renders the server as
`pending - connecting; tools load on demand via Tool Search` and produces **no**
failure diagnostic, because a connecting server is healthy.

A separate test feeds a terminal `failed` status with no browser tools and
asserts that exactly one Playwright-specific diagnostic is produced. Another
test models the June 15 `system.init` event (`playwright` `pending`, no browser
tools but `ToolSearch` present) and asserts that no failure is produced, and a
regression guard asserts that `src/claude.lib.mjs` does not reference any
`getPlaywrightMcpSessionInitFailure`-style session-aborting guard.

## Follow-up Review Notes

The PR #1907 follow-up review asked whether `--skip-tool-connection-check` and
the deployment gist's `--no-tool-check` overrides should affect Playwright MCP.
They should not. Those flags only skip paid AI-tool connection probes; the
`solve` Playwright MCP preflight is local/free and still runs when Playwright
support is enabled. Dry-run mode remains the only broad solve path that skips
that preflight.

Telegram `/version` uses the same `formatVersionMessage()` path as CLI version
reporting, so pending or otherwise unavailable Playwright MCP rows render as
`not connected` there as well.

The checked deployment gist already re-applies Claude and Codex Playwright MCP
registration after host-mounted `/home/box/.claude*` and `/home/box/.codex`
configuration can shadow image-baked defaults. No required gist change is
needed to remove `--no-tool-check` after this fix. A useful future hardening is
to align the gist's status parsing with Hive Mind's shared unavailable-row
patterns and keep explicit `playwright --version` plus
`npx --no-install @playwright/mcp --help` probes.

## Limitations

This Hive Mind fix does not force a running Claude Code process to reconnect a
pending MCP server or overwrite an existing custom Playwright registration. It
keeps the local `mcp list` preflight honest (pending/failed rows do not enable
browser hints), repairs the default registration only when no Playwright MCP row
exists, and surfaces a non-blocking diagnostic only for a terminal `failed`
`system.init` status. It deliberately does **not** abort a session on a
`pending` status, because Tool Search resolves the deferred `mcp__playwright__*`
tools on demand. If a future run reports a genuinely terminal `failed` status,
the next debugging target is the MCP client/server startup path: CLI MCP
configuration, filtered strict config contents, server command startup,
browser/display availability, and client logs.
