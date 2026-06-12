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
browser automation hints, and `system.init` comments now render pending
Playwright as `pending - not connected; MCP tools unavailable` with a
diagnostic when no `mcp__playwright__*` tools are present.

Follow-up review on PR #1907 pointed out that the Docker images are expected to
ship working Playwright MCP and Playwright CLI fallback, and that persisted
`/home/box/.codex` mounts can hide image-baked Codex MCP config. This PR now
also hardens image verification: Docker builds and `verify-docker-image.sh`
check the Playwright CLI, the local `@playwright/mcp` package, and healthy
Claude/Codex MCP list rows instead of accepting any row containing
`playwright`. Runtime Claude/Codex preflight also restores the default
Playwright MCP registration when it is completely missing and the MCP package
is installed.

The linked `kefine#173` E2E failures had a separate root cause: stale
Playwright specs after UI changes in `kefine#174` and `kefine#175`. That
external PR was ultimately made green by updating those specs on commit
`b020bd3`; the logs show no evidence that MCP browser tools were available in
the Claude sessions.

## Required Artifacts

All downloaded issue, PR, comment, AI-session, and CI artifacts are kept under
this directory:

| Path                                                         | Purpose                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `data/raw/hive-mind-issue-1901.json`                         | Source issue metadata and body                                        |
| `data/raw/hive-mind-pr-1907.json`                            | Prepared Hive Mind PR metadata                                        |
| `data/raw/kefine-issue-172.json`                             | External issue linked by `kefine#173`                                 |
| `data/raw/kefine-pr-173.json`                                | External PR metadata                                                  |
| `data/raw/kefine-pr-173-issue-comments.json`                 | External PR conversation comments, including `system.init` comments   |
| `data/raw/kefine-issue-172-run-list.json`                    | Recent GitHub Actions runs for the external branch                    |
| `data/raw/kefine-pr-174.json`                                | Related frontend PR metadata                                          |
| `data/raw/kefine-pr-175.json`                                | Related frontend PR metadata                                          |
| `data/raw/deploy-gist-67532e7a7090462a618ca86fc00d06a6.txt`  | Deployment script referenced by PR review feedback                    |
| `data/external-logs/solution-draft-log-pr-1781180008338.txt` | First AI session log                                                  |
| `data/external-logs/auto-restart-log-pr-1781183077272.txt`   | Auto-restart AI session log                                           |
| `data/ci-logs/*.log`                                         | Downloaded GitHub Actions logs from passing and failing external runs |

No screenshots were present in the issue or linked PR comments.

## Timeline

| Time (UTC)             | Event                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-06-11 10:34:20    | `lefinepro/kefine#173` opened from branch `issue-172-89c7bbd53971`.                                                                                                                                                                                          |
| 2026-06-11 10:34:34    | First interactive session comment (`4679640744`) showed `playwright` as `pending` and no `mcp__playwright__*` tools. The same raw event is visible in `solution-draft-log-pr-1781180008338.txt` around line 669.                                             |
| 2026-06-11 11:17-11:21 | External PR #174/release CI showed E2E failures such as missing compare-button/modal expectations. Example: `kefine-pr174-ci-27342994477-failure.log` lines 589-896 and `kefine-release-ci-27343025495-failure.log` lines 2369-2676.                         |
| 2026-06-11 12:04       | External PR #175 CI showed E2E failures for removed or changed UI elements, including `[data-part="open-solvers"]`, `kefine-task-document-description`, and `/@api/order-1` URL expectations. See `kefine-pr175-ci-27345064569-failure.log` lines 5611-5816. |
| 2026-06-11 12:13:50    | Auto-restart session comment (`4680396501`) again showed `playwright` as `pending` with no Playwright MCP tools.                                                                                                                                             |
| 2026-06-11 12:15       | External PR #173 CI failed on commit `505d7c7`; `kefine-ci-27346030359-failure.log` shows 16 E2E failures at lines 1904-1923.                                                                                                                                |
| 2026-06-11 12:37:48    | External PR #173 CI and Lighthouse runs started on `b020bd3`; both completed successfully.                                                                                                                                                                   |
| 2026-06-11 13:04:21    | External final summary comment (`4680853216`) stated local `CI=1 playwright test` passed with 129 tests and all 8 checks were green on `b020bd3`. The auto-restart log contains the same result around line 100673.                                          |
| 2026-06-11 17:27:10    | PR #1907 review feedback requested checking the Hive Mind Docker/DinD image and deployment script because Playwright MCP and the Playwright CLI fallback should be accessible in all images.                                                                 |
| 2026-06-11 22:28+      | Local container verification showed `codex mcp list` with Playwright `enabled`, `claude mcp list` with Playwright `Connected`, `playwright --version` returning `1.60.0`, and `npx --no-install @playwright/mcp --help` exposing server options.             |

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
  is available when the MCP client only reports a pending server.
- The PR comment created from `system.init` must make pending MCP state
  actionable for humans reviewing the run.
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

| Component                                             | Role before this PR                                  | Change                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/playwright-mcp.lib.mjs`                          | Shared Playwright MCP utilities and disable helpers  | Adds `hasConnectedPlaywrightMcpServer()` and row extraction helpers                     |
| `src/claude.lib.mjs`                                  | Claude execution and Playwright MCP prompt preflight | Uses the shared parser instead of substring matching                                    |
| `src/codex.lib.mjs`                                   | Codex execution and Playwright MCP prompt preflight  | Uses the shared parser instead of substring matching                                    |
| `src/version-info.lib.mjs`                            | `/version` browser automation status rendering       | Uses the shared parser so pending rows render as not connected                          |
| `src/interactive-mcp-status.lib.mjs`                  | New shared interactive status helpers                | Formats pending/unavailable MCP status and emits Playwright-specific diagnostics        |
| `src/interactive-mode.lib.mjs`                        | Renders `system.init` PR comments                    | Marks pending/failed MCP status as unavailable and adds Playwright-specific diagnostics |
| `Dockerfile`, `Dockerfile.dind`, `coolify/Dockerfile` | Docker image build contracts                         | Verify Playwright CLI fallback, local MCP package availability, and healthy MCP rows    |
| `scripts/verify-docker-image.sh`                      | Runtime image verification in CI                     | Rejects pending/unavailable Claude/Codex Playwright rows and checks MCP package access  |
| `tests/test-issue-1901-playwright-mcp-pending.mjs`    | New regression coverage                              | Reproduces the pending-list-row and pending-system-init cases                           |

## Solution

1. Add a shared parser in `playwright-mcp.lib.mjs` that extracts Playwright
   MCP list rows and rejects rows containing pending, disabled, failed,
   disconnected, timeout, or not-connected statuses.
2. Change Claude and Codex preflight checks to use that parser.
3. Add interactive MCP status helpers that:
   - render pending as `pending - not connected; MCP tools unavailable`;
   - detect pending/unavailable Playwright MCP with no `mcp__playwright__*`
     tools;
   - include a blockquoted diagnostic in the session-start comment.
4. Restore the default Claude/Codex Playwright MCP registration only when it is
   completely absent and the local MCP package is available. This repairs the
   common Docker case where a persisted `/home/box/.codex` mount overrides the
   image-baked config.
5. Harden Docker build/runtime verification so CI fails on pending/unavailable
   MCP status and on missing Playwright CLI or `@playwright/mcp` fallback.
6. Add a focused default-suite regression test for issue #1901.

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

The expected comment now states that Playwright MCP tools are unavailable and
warns that no `mcp__playwright__*` tools were exposed.

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
prevents Hive Mind from treating pending as usable browser access, makes the
missing tool exposure visible in PR comments, and repairs the default
registration only when no Playwright MCP row exists. If a future run still
shows pending, the next debugging target is the MCP client/server startup path:
CLI MCP configuration, server command startup, browser/display availability,
and client logs.
