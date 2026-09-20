# Case Study: Playwright MCP preflight failed (#1943)

## Summary

Issue [#1943](https://github.com/link-assistant/hive-mind/issues/1943) was filed
after a Hive Mind `solve` run stopped **before creating a pull request** with:

```text
The solver stopped before creating a pull request.

Reason: Playwright MCP preflight failed
```

The run targeted the external issue
[`G-Ivan-A/mango_ba_prompts#109`](https://github.com/G-Ivan-A/mango_ba_prompts/issues/109)
and posted its failure notice as
[comment `4742253455`](https://github.com/G-Ivan-A/mango_ba_prompts/issues/109#issuecomment-4742253455).

The attached log (reproduced in full at
`data/external-logs/solve-failure-2026-06-18T13-10-10.log`) shows the entire run
ending inside the local Playwright MCP preflight:

```text
[2026-06-18T13:10:16.314Z] [INFO] 🎭 Checking Playwright MCP preflight for Claude Code...
[2026-06-18T13:10:21.869Z] [ERROR] ❌ Playwright MCP preflight failed for Claude Code
[2026-06-18T13:10:21.870Z] [ERROR]    Playwright support is enabled by default, so solve stops before starting an AI working session.
[2026-06-18T13:10:21.873Z] [ERROR] ❌ Playwright MCP preflight failed
```

**The gap between "Checking" and "failed" is 5.555 seconds.** The Claude preflight
runs `timeout 5 claude mcp list`, so this is the smoking gun: the 5-second
`timeout` killed the probe (~5s + ~0.5s process spawn ≈ 5.55s). `claude mcp list`
did not return in time, `ensureConnectedPlaywrightMcpServer` saw a non-zero exit,
returned `false`, and `src/solve.mjs` aborted the entire run via
`safeExit(1, 'Playwright MCP preflight failed')`.

This is the same class of false negative that
[issue #1901](./../issue-1901/README.md) resolved for the **in-session** path: a
Playwright MCP server that is merely _slow to confirm_ or _still connecting_ is
**not** a failure, because Claude Code's Tool Search loads MCP tools on demand and
waits for a connecting server before using one of its tools. Issue #1901 removed
the in-session hard-fail but the **local preflight** in `src/solve.mjs` kept its
own hard-abort, which is what #1943 hit.

### Fix

1. **An inconclusive `mcp list` probe no longer aborts the solve.** When
   `claude mcp list` / `codex mcp list` times out, crashes, or its binary is
   missing, the probe result is _unknown_ — not _broken_. The preflight now falls
   back to the local `@playwright/mcp` package check. If the package is installed
   (it is baked into every Hive Mind image), the server can connect on demand via
   Tool Search, so the working session proceeds. The preflight only fails when the
   package itself is genuinely unavailable.
2. **The probe timeout is generous and configurable.** It defaults to **30s**
   (up from 5s) because `claude mcp list` performs a live health check that
   launches a browser, and is overridable via
   `PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS`.
3. **The preflight now emits verbose diagnostics.** The original failure log went
   straight from "Checking…" to "failed" with `--verbose` enabled and no
   explanation. The probe now logs the `mcp list` exit code, the matched
   Playwright rows, the chosen decision branch, and the package-availability
   result, so the next failure is diagnosable from the log alone.

Untouched on purpose: a successfully-probed but **pending/disabled** registration
row is still left as-is (the issue #1901 contract — do not overwrite an
in-progress or intentional registration), and the `safeExit(1)` guard in
`src/solve.mjs` still fires when the package is truly missing.

## Data Collected

All downloaded artifacts are under this directory.

| Path                                                       | Purpose                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `data/raw/hive-mind-issue-1943.json`                       | Source issue metadata and body                                |
| `data/raw/hive-mind-issue-1943-comments.json`              | Issue comments (empty at investigation time)                  |
| `data/raw/hive-mind-pr-1944.json`                          | Prepared Hive Mind PR metadata                                |
| `data/raw/hive-mind-pr-1944-conversation-comments.json`    | PR conversation comments (empty at investigation time)        |
| `data/raw/hive-mind-pr-1944-review-comments.json`          | PR inline review comments (empty at investigation time)       |
| `data/raw/external-comment-4742253455.json`                | The external failure-notice comment that #1943 links to       |
| `data/raw/external-mango-issue-109.json`                   | The external issue the failed run targeted (context only)     |
| `data/external-logs/solve-failure-2026-06-18T13-10-10.log` | The full 3.6 KB solver log extracted from the failure comment |
| `data/raw/solver-failure-comment-4742253455.md`            | The raw Markdown body of the failure comment                  |

No screenshots were present in the issue or the linked comment.

## Timeline (UTC)

| Time                    | Event                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-12 09:52:01     | Commit `5ec48227` _"fix: fail solve on playwright mcp preflight failure"_ adds the hard `safeExit(1, 'Playwright MCP preflight failed')` to `solve.mjs`. |
| 2026-06-16              | PR #1932 (issue #1901) removes the **in-session** pending hard-fail, concluding that a pending/connecting Playwright MCP is normal (Tool Search).        |
| 2026-06-18 13:10:10.409 | The failed `solve` run starts on `mango_ba_prompts#109` (`--model opus --tool claude --attach-logs --verbose --no-tool-check ...`).                      |
| 2026-06-18 13:10:16.314 | `🎭 Checking Playwright MCP preflight for Claude Code...` — `timeout 5 claude mcp list` begins.                                                          |
| 2026-06-18 13:10:21.869 | `❌ Playwright MCP preflight failed for Claude Code` — **5.555 s later**, matching the 5 s `timeout` killing the probe.                                  |
| 2026-06-18 13:10:21.875 | The solver posts the failure notice to issue #109 and exits without a PR.                                                                                |
| 2026-06-18 13:10:24     | Failure-notice comment `4742253455` created on `mango_ba_prompts#109`.                                                                                   |
| 2026-06-18 13:14:42     | Issue #1943 filed in `link-assistant/hive-mind` (label `bug`).                                                                                           |

## Requirements Inferred From The Issue

The issue body is a generic case-study directive. Mapped to concrete requirements:

1. **R1 — Stop the spurious abort.** A Hive Mind run must not stop before creating
   a PR merely because the local `claude mcp list` / `codex mcp list` probe could
   not confirm a connected Playwright MCP server within a short timeout.
2. **R2 — Preserve the data.** Download all logs/data about the issue into
   `docs/case-studies/issue-1943/`.
3. **R3 — Analyse.** Reconstruct the timeline, enumerate requirements, find the
   root cause, and propose solution plans (checking existing components/libraries).
4. **R4 — Add observability when data is insufficient.** The original log had no
   verbose detail about _why_ the preflight failed. Add debug output / verbose
   mode so the next occurrence is diagnosable.
5. **R5 — Fix everywhere.** Apply the fix across the whole codebase wherever the
   same pattern exists (all tools, not just Claude).
6. **R6 — Report upstream if applicable.** If the root cause lives in another
   repository, file a reproducible issue there.

## Root Cause

`src/solve.mjs` runs the preflight before the working session:

```js
if (!argv.dryRun && argv.playwrightMcp !== false) {
  const playwrightMcpPreflight = await ensureSolvePlaywrightMcpReady({ argv, log });
  if (!playwrightMcpPreflight.ok) {
    await safeExit(1, 'Playwright MCP preflight failed');
  }
}
```

For `--tool claude` that resolves to `ensureClaudePlaywrightMcpServer` →
`ensureConnectedPlaywrightMcpServer`, whose **first** guard was:

```js
const result = await list().catch(() => null);
if (!isCommandResultSuccess(result)) return false; // ← timeout lands here
```

with `list: () => $\`timeout 5 claude mcp list 2>&1\``.

`claude mcp list` does not just print a static table — it performs a **live health
check** against every configured MCP server, and the Playwright MCP server
launches a browser to report its status. On a cold `npx` cache or a busy host
that easily exceeds 5 seconds. When `timeout` killed it, `result` carried a
non-zero exit code, `isCommandResultSuccess` was `false`, the function returned
`false`, and `solve.mjs` aborted — **before any work, and before a PR could be
created.**

Two design problems compounded this:

- **A timed-out probe was treated as proof of failure.** "We could not determine
  the status in 5 s" is not the same as "Playwright MCP is broken." Returning
  `false` (which aborts the run) for an _unknown_ status is wrong, and it
  contradicts issue #1901's own conclusion that a not-yet-connected Playwright
  MCP is fine because Tool Search resolves the deferred tools on demand.
- **No observability.** Even with `--verbose`, the preflight emitted nothing
  between "Checking…" and "failed," so the failure could not be root-caused from
  the log; the 5.555 s gap was the only clue.

### Why this is the local twin of issue #1901

Issue #1901 fixed the **in-session** path: a `system.init` event reporting
`playwright (pending)` no longer aborts the Claude session, because the same
event also exposes `ToolSearch` and `total_deferred_tools` — the signature of
deferred MCP tools loading on demand. #1943 is the **pre-session** twin: the
local `mcp list` preflight applied an even stricter, abort-the-whole-run gate to
the very same "not connected _yet_" condition.

## Solution Options Considered

| Option                                                                     | Verdict                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Just bump `timeout 5` → `timeout 30`.                                      | Helps, but still aborts the whole run on any genuinely slow/stuck probe. Necessary but not sufficient.                    |
| Skip the preflight when `--no-tool-check` is set.                          | Rejected: the preflight is deliberately independent of paid tool-connection checks (issue #1901 test enforces this).      |
| Treat an inconclusive probe as _unknown_ → fall back to the package check. | **Chosen.** Matches issue #1901's reasoning (Tool Search connects on demand) and keeps a real failure (no package) fatal. |
| Remove the preflight entirely.                                             | Rejected: it still catches a genuinely missing `@playwright/mcp` package, and registers a missing server.                 |

### Existing components reused

- `checkPlaywrightMcpPackageAvailability()` — already in `playwright-mcp.lib.mjs`;
  reused as the inconclusive-probe fallback (no new dependency).
- The shared `log({ verbose })` callback threaded from `solve.mjs` — reused for
  the new diagnostics; no new logging library.
- `coreutils` `timeout(1)` — already used; only its argument is now configurable.

No third-party library was needed.

## The Fix (applied in this PR)

`src/playwright-mcp.lib.mjs`:

- Added `getPlaywrightMcpListTimeoutSeconds(env)` /
  `PLAYWRIGHT_MCP_LIST_TIMEOUT_SECONDS_DEFAULT` (30 s, overridable via
  `PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS`).
- `ensureConnectedPlaywrightMcpServer` now: logs the probe exit code + matched
  rows; on an inconclusive probe (`!isCommandResultSuccess`) returns
  `hasPackage(...)` instead of `false`; keeps the pending-row contract; and logs
  every decision branch.
- `checkPlaywrightMcpPackageAvailability`, `ensureClaudePlaywrightMcpServer`,
  `ensureCodexPlaywrightMcpServer` accept an optional `{ log }` and use the
  configurable timeout. **R5** is satisfied because all tools funnel through the
  one shared `ensureConnectedPlaywrightMcpServer` / `checkPlaywrightMcpPackageAvailability`.
- `ensureSolvePlaywrightMcpReady` passes `log` into the check function.

`docs/CONFIGURATION.md`: documents the new timeout env var and the fallback
behaviour.

`tests/test-issue-1943-playwright-mcp-preflight-timeout.mjs`: reproduces the bug
(a timed-out probe + installed package now returns `true`/proceeds) and guards
the contract (missing package still fails; pending row still untouched; connected
probe unaffected; `solve.mjs` keeps its guard).

## Reproduction

Before the fix, with `@playwright/mcp` installed but a `claude mcp list` that
takes >5 s, the preflight aborts. The unit test reproduces this deterministically
by injecting a timed-out `list` result:

```js
const connected = await ensureConnectedPlaywrightMcpServer({
  list: async () => ({ code: 124, stdout: '', stderr: '' }), // timeout(1) exit
  add: async () => ({ code: 0 }),
  hasPackage: async () => true,
});
// before: false  → solve aborts
// after:  true   → solve proceeds (Tool Search connects on demand)
```

Run it with:

```bash
node tests/test-issue-1943-playwright-mcp-preflight-timeout.mjs
```

## Upstream / Other Repositories (R6)

The root cause is entirely inside Hive Mind (`src/playwright-mcp.lib.mjs` +
`src/solve.mjs`); the external repo `mango_ba_prompts` was only the _target_ of
the failed run, not the source of the bug, so no external issue is warranted
there.

A secondary, _contributing_ factor is that `claude mcp list` performs a
synchronous live health check that can exceed several seconds when a registered
MCP server is slow to start. This is upstream Claude Code behaviour. We did **not**
file an upstream issue because (a) we have no direct repro isolated to the CLI
(the 5.555 s timing is strong but circumstantial), and (b) Hive Mind's fix makes
the slowness non-fatal regardless of upstream timing. If a clean CLI-only repro
surfaces later, it should be reported to `anthropics/claude-code` with the
`mcp list` duration and server configuration; this case study is the seed for
that report.
