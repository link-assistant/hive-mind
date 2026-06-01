# Case Study — Issue #1845: Surface the core error message instead of bare `CLAUDE execution failed`

- **Issue:** [#1845 — We need to show users core error message, not just `CLAUDE execution failed`](https://github.com/link-assistant/hive-mind/issues/1845)
- **Pull Request:** [#1846](https://github.com/link-assistant/hive-mind/pull/1846)
- **Label:** `bug`
- **Reported from:** [xlabtg/teleton-agent#519 (comment 4583539585)](https://github.com/xlabtg/teleton-agent/pull/519#issuecomment-4583539585)
- **Date analyzed:** 2026-05-30

---

## 1. Requirements extracted from the issue

Each requirement is tracked with its status in this PR.

| #   | Requirement                                                                                                                                                                                                                     | Status                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| R1  | Show the **core error message** to the user: instead of `CLAUDE execution failed`, show `CLAUDE execution failed with API Error: Output blocked by content filtering policy`, so the user has a rough idea what went wrong.     | ✅ Implemented                                                                                        |
| R2  | On **all failures**, automatically commit (and push) uncommitted changes.                                                                                                                                                       | ✅ Tool-failure path verified + **exception/rejection/main-error paths gap closed** (see §4.4)        |
| R3  | Download all logs/data about the issue into `./docs/case-studies/issue-1845/` and do a **deep case study** (timeline, requirement list, root causes, solution plans, known libraries). Also search online for additional facts. | ✅ This document                                                                                      |
| R4  | If there is **not enough data** to find the root cause, add debug output / verbose mode for the next iteration.                                                                                                                 | ✅ Root cause found; verbose tracing already present and confirmed sufficient                         |
| R5  | If the issue relates to **another repository/project**, report it there with reproducible examples, workarounds, and fix suggestions.                                                                                           | ✅ Analyzed — see §7 (upstream is Anthropic Claude CLI behavior; no hive-mind bug to report upstream) |
| R6  | **Apply the fix across the entire codebase** — if the problem exists in multiple places, fix all of them.                                                                                                                       | ✅ All tool runners + all failure-display sites                                                       |
| R7  | Plan and execute everything in the **single PR #1846**.                                                                                                                                                                         | ✅                                                                                                    |

---

## 2. Timeline / sequence of events

Reconstructed from the failure log in [`raw-data/solution-draft-log.txt`](./raw-data/solution-draft-log.txt) (downloaded from the Gist linked in the upstream failure comment). All timestamps UTC.

| Time                    | Event                                                                                                                                                                                                            | Log evidence                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 17:18:21                | AI work session started on `xlabtg/teleton-agent#519`.                                                                                                                                                           | "AI Work Session Started" comment |
| 17:18:32                | Claude CLI session begins; session id `45441128-80e2-48c1-a2ea-f81ede05030b`.                                                                                                                                    | line 564, 651                     |
| 17:18:34 – 17:20:40     | 18 turns of normal streamed `assistant`/`tool` messages, all `"is_error": false`.                                                                                                                                | lines 957–4900                    |
| 17:20:40.898            | Claude CLI emits an **assistant message** whose text is `API Error: Output blocked by content filtering policy`, with top-level `"error": "unknown"`.                                                            | line 5097, 5105                   |
| 17:20:40.901            | Claude CLI emits the **result event**: `"subtype": "success"`, **`"is_error": true`**, `"num_turns": 18`, `"result": "API Error: Output blocked by content filtering policy"`, `"stop_reason": "stop_sequence"`. | lines 5108–5117                   |
| 17:20:40.902            | hive-mind captures result summary; logs `📝 Captured result summary from Claude output`.                                                                                                                         | line 5169                         |
| 17:20:40.903            | hive-mind detects the error: `⚠️ Detected error from Claude CLI (subtype: success)`.                                                                                                                             | line 5171                         |
| 17:20:41.280            | Exit code updated to `1` from command result.                                                                                                                                                                    | line 5173                         |
| 17:20:41.281            | Terminal shows `❌ Claude command failed with exit code 1`.                                                                                                                                                      | line 5176                         |
| 17:20:41.306            | hive-mind begins `📄 Attaching failure logs to Pull Request...`.                                                                                                                                                 | line 5202                         |
| (earlier run, 17:00:06) | The posted GitHub failure comment shows only ` ```CLAUDE execution failed``` ` — **the captured core error never reached the user**.                                                                             | embedded comment at line 163      |

**Key observation:** the real error string (`API Error: Output blocked by content filtering policy`) _was_ captured inside `claude.lib.mjs` (`lastMessage`/`result`), but it was **dropped** before the user-facing layer. The terminal and the GitHub comment showed only the generic `CLAUDE execution failed`.

---

## 3. Root cause analysis

### 3.1 Where the real error lives

In `src/claude.lib.mjs`, the streamed `result` event sets:

```js
if (data.is_error === true) {
  lastMessage = data.result || JSON.stringify(data);   // "API Error: Output blocked by content filtering policy"
  ...
  await log(`⚠️ Detected error from Claude CLI (subtype: ${subtype})`, { verbose: true });
}
```

So `lastMessage` correctly held the meaningful error.

### 3.2 Where it was lost (the bug)

The failure `return` objects from the tool runner only reported `success: false` and **did not carry the captured error message**. For example, the main command-failed return contained no `errorInfo`. The caller in `src/solve.mjs` then built the user-facing message from a hardcoded template:

```js
// BEFORE — solve.mjs
const toolForFailure = argv.tool || 'claude';
// ... only ever produced:
`${toolForFailure.toUpperCase()} execution failed`;
```

This same generic string was passed as `errorMessage` to `attachLogToGitHub`, which renders it verbatim inside the `🚨 Solution Draft Failed` comment (`src/github.lib.mjs`):

```
## 🚨 Solution Draft Failed
The automated solution draft encountered an error:
```

CLAUDE execution failed

```

```

**Root cause:** a _data-propagation gap_ — the tool runners discarded the captured core error (`lastMessage`) at their failure-return boundary, so every downstream consumer (terminal exit message, GitHub failure comment, auto-commit reason) could only fall back to the generic phrase.

### 3.3 Why it affected multiple places (R6)

The same pattern existed across **every** AI tool runner except `codex` and `agent` (which already returned a structured `errorInfo`):

- `claude.lib.mjs` — 4 failure returns, none carried the error
- `gemini.lib.mjs` — 2 failure returns
- `opencode.lib.mjs` — 3 failure returns
- `qwen.lib.mjs` — 2 non-limit failure returns

And the consumption side had four independent display/exit/log sites:

- `solve.mjs` (terminal exit + GitHub failure comment + auto-commit reason)
- `solve.auto-merge.lib.mjs` (auto-merge resume + general failure)
- `solve.watch.lib.mjs` (watch-mode failure)
- `review.mjs` (review-command failure)

A fix in only one place would have left the bug in the others — matching R6's "fix it in all of them."

---

## 4. Solution implemented

### 4.1 Producer side — every runner now surfaces `errorInfo`

Each tool runner's failure return now includes a structured
`errorInfo: { message, exitCode? }` carrying the captured core error:

- `claude.lib.mjs` — `errorInfo: { message: lastMessage || \`Claude command failed with exit code ${exitCode}\`, exitCode }` on all 4 failure returns (stuck-retry, transient-persisted, command-failed, exception).
- `gemini.lib.mjs` — `errorInfo: { message: errorText || ... }` + exception case.
- `opencode.lib.mjs` — `errorInfo` on permission-prompt, command-failed, and exception returns.
- `qwen.lib.mjs` — `errorInfo: { message: combinedErrorText || errorMessage || ... }` + exception case.
- `codex.lib.mjs` / `agent.lib.mjs` — already returned structured error info; left as-is (their `errorInfo.message` is compatible).

### 4.2 Shared extractor + formatter — single source of truth

Two exported helpers in `src/lib.mjs` share **one** precedence so every failure
surface shows the same root cause and they can never diverge:

```js
// Returns just the core error string (no prefix), or null when none is available.
export const extractToolErrorCore = ({ toolResult } = {}) => {
  const errorInfo = toolResult?.errorInfo;
  const rawCore = errorInfo?.message || errorInfo?.errorMatch || (typeof errorInfo === 'string' ? errorInfo : null) || toolResult?.result || null;
  if (!rawCore || typeof rawCore !== 'string') return null;
  const core = rawCore.replace(/\s+/g, ' ').trim();
  return core || null;
};

// Builds the full "<TOOL> execution failed with <core>" message for comments/exit.
export const formatToolExecutionFailure = ({ tool, toolResult, maxLength = 300 } = {}) => {
  const base = `${(tool || 'claude').toUpperCase()} execution failed`;
  let core = extractToolErrorCore({ toolResult });
  if (!core) return base;
  if (core.toLowerCase().includes('execution failed')) return base; // avoid duplication
  if (core.length > maxLength) core = `${core.slice(0, maxLength - 1)}…`;
  return `${base} with ${core}`;
};
```

Design decisions:

- **Does not** fall back to `resultSummary` — that field holds the agent's _normal_ work summary on success, and would be misleading as an "error."
- Collapses whitespace/newlines to a single clean line.
- Caps at 300 chars (in the formatter) to keep terminal/comment output readable.
- Avoids duplicating the base phrase when the core already contains "execution failed."
- `extractToolErrorCore` is the shared root-cause extractor reused by the terminal
  "Error details:" lines (watch / auto-merge / review) so they show the **same**
  core error as the GitHub comment, without the "<TOOL> execution failed with" prefix.

### 4.3 Consumer side — every display / exit / log site shows the core error

- `solve.mjs`: terminal exit message, GitHub failure-comment `errorMessage`, and the auto-commit `reason` all use `formatToolExecutionFailure(...)`.
- `solve.auto-merge.lib.mjs`: resume-failure and general-failure GitHub `errorMessage` use `formatToolExecutionFailure`; the **terminal** `RESUME FAILED` / `EXECUTION FAILED` blocks now also print an `Error details:` line via `extractToolErrorCore(...)`.
- `solve.watch.lib.mjs`: watch-mode failure GitHub `errorMessage` uses `formatToolExecutionFailure`; the **terminal** `MAXIMUM API ERROR RETRIES REACHED` block's `Error details:` line now uses `extractToolErrorCore(...)` instead of `toolResult.result` (which is frequently unset on Claude failures, so it previously printed "Unknown API error").
- `review.mjs`: the generic `❌ Command execution failed. Check the log file for details.` now appends the core error via `extractToolErrorCore(...)` when one is available.

**Result:** for the exact scenario in this issue, the user now sees

```
CLAUDE execution failed with API Error: Output blocked by content filtering policy
```

both in the terminal and in the posted GitHub failure comment — and the same core
string appears in the watch / auto-merge "Error details:" terminal lines.

### 4.4 Auto-commit on all failures (R2)

Issue #1834 already added `commitUncommittedChangesOnCriticalError` (gated by
`config.lib.mjs` → `criticalErrorRecovery.autoCommitUncommittedChanges`, env
`HIVE_MIND_AUTO_COMMIT_ON_CRITICAL_ERROR`, default `true`). It runs in the
failure-exit block of `solve.mjs` (before `safeExit(1, ...)`) and again at the
general post-session chokepoint for limit/error cases. This PR routes the
improved failure message into the commit `reason`, so the auto-commit is both
**guaranteed on the tool-failure path** and **labeled with the real cause**.

**Gap closed in this PR.** The tool-failure chokepoint in `solve.mjs` only covers
the _graceful_ failure path. Three other exits bypassed it entirely and could
leave the agent's work uncommitted on disk:

- `uncaughtException` (`createUncaughtExceptionHandler`)
- `unhandledRejection` (`createUnhandledRejectionHandler`)
- the top-level `catch` in `solve.mjs` (`handleMainExecutionError`)

All three funnel through `handleFailure()` in `src/solve.error-handlers.lib.mjs`,
so this PR adds the **same guarded auto-commit at the very start of
`handleFailure()`** — before issue creation / log attachment / PR close. It is
gated by the identical config flag and only acts when `cleanupContext.tempDir`
is set (a working tree exists). To make the working-tree state reachable from the
exception handlers, `solve.mjs` now threads the in-place-mutated `cleanupContext`
object into `errorHandlerOptions` and the `handleMainExecutionError` call. The
step is best-effort: a commit/push failure is swallowed (logged at verbose level)
so it can never mask the original error that triggered the exit.

This is verified by `tests/test-issue-1845-failure-auto-commit.mjs` (6 tests):
commit+push on a dirty tree, no-commit on a clean tree, skip when
`cleanupContext` is absent or has no `tempDir`, never-throws when git fails, and
the config default being `true`.

---

## 5. Tests

`tests/format-tool-execution-failure-1845.test.mjs` (27 assertions) reproduces
the bug and locks in the fix:

- The exact issue example (`API Error: Output blocked by content filtering policy`).
- Generic fallback when no `errorInfo` is present.
- `resultSummary` is **not** used as an error.
- Whitespace collapsing, truncation, duplicate-phrase avoidance.
- **Cross-tool result-shape tests** confirming the helper extracts the message
  from the real shapes returned by claude / codex (`getCodexErrorEventSummary`)
  / gemini / opencode / qwen / agent.
- **`extractToolErrorCore` tests** (the shared extractor used by the terminal
  "Error details:" lines): core extraction, the `message → errorMatch → string →
result` precedence, whitespace collapsing, null cases, and that it does **not**
  use `resultSummary`.

`tests/test-issue-1845-failure-auto-commit.mjs` (6 assertions) locks in R2 for
the exception/rejection/main-error paths by driving `handleFailure()` with a
scriptable `$` command-stream double — see §4.4.

---

## 6. Known components / libraries considered (R3)

- **`cleanErrorMessage` (existing in `src/lib.mjs`)** — strips shell noise from
  `Error` objects. Reused conceptually; the new helper does its own light
  normalization tuned for tool-result strings rather than exceptions.
- **`getCodexErrorEventSummary` (existing in `src/codex.lib.mjs`)** — already the
  "structured error" pattern; the fix generalizes the same idea (`errorInfo`
  object with a `.message`) to all runners, so no new dependency is needed.
- **`commitUncommittedChangesOnCriticalError` (existing, Issue #1834)** — reused
  for R2 instead of writing new auto-commit logic.
- No external npm library was warranted: this is an internal data-propagation
  fix, and adding a dependency for string formatting would be over-engineering.

---

## 7. Upstream / cross-repo analysis (R5)

- The originating run was on **`xlabtg/teleton-agent#519`**, but that repo only
  _consumed_ hive-mind; the bug (dropping the error message) is entirely in
  **this** repo, so it is fixed here.
- The underlying `API Error: Output blocked by content filtering policy` is a
  **server-side content-filtering response from Anthropic's Claude API/CLI**,
  surfaced as `result` with `is_error: true`, `subtype: success`,
  `stop_reason: stop_sequence`. This is _expected upstream behavior_, not a
  hive-mind defect — there is no reproducible hive-mind bug to file against the
  Claude CLI. The correct hive-mind behavior is exactly what this PR does:
  faithfully surface that message to the user. No external issue is required.

---

## 8. Files changed

| File                                                | Change                                                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib.mjs`                                       | Added exported `extractToolErrorCore` extractor + `formatToolExecutionFailure` helper (formatter reuses extractor)                             |
| `src/claude.lib.mjs`                                | Added `errorInfo` to all 4 failure returns                                                                                                     |
| `src/gemini.lib.mjs`                                | Added `errorInfo` to command-failed + exception returns                                                                                        |
| `src/opencode.lib.mjs`                              | Added `errorInfo` to 3 failure returns                                                                                                         |
| `src/qwen.lib.mjs`                                  | Added `errorInfo` to command-failed + exception returns                                                                                        |
| `src/solve.mjs`                                     | Use `formatToolExecutionFailure` for terminal exit / GitHub comment / auto-commit reason; thread `cleanupContext` into the error handlers (R2) |
| `src/solve.auto-merge.lib.mjs`                      | Helper for resume + general failure GitHub messages; new `Error details:` terminal line via `extractToolErrorCore`                             |
| `src/solve.watch.lib.mjs`                           | Helper for watch-mode GitHub message; `Error details:` terminal line now uses `extractToolErrorCore`                                           |
| `src/review.mjs`                                    | Append the core error to the generic `Command execution failed` message via `extractToolErrorCore`                                             |
| `src/solve.error-handlers.lib.mjs`                  | `handleFailure()` auto-commits uncommitted work (R2) on exception / rejection / main-error exits before exiting                                |
| `tests/format-tool-execution-failure-1845.test.mjs` | Unit + cross-tool tests + `extractToolErrorCore` tests (27)                                                                                    |
| `tests/test-issue-1845-failure-auto-commit.mjs`     | New tests for the R2 exception-path auto-commit in `handleFailure()` (6)                                                                       |
| `docs/case-studies/issue-1845/`                     | This case study + raw failure log                                                                                                              |
