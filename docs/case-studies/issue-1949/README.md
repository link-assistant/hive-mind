# Case study — Issue #1949: retryable results must not switch the `--model` fallback

- Issue: <https://github.com/link-assistant/hive-mind/issues/1949>
- Fix PR: <https://github.com/link-assistant/hive-mind/pull/1950>
- Reported by: `konard` at 2026-06-19 06:42 UTC
- Triggering run: solve session for issue #1945 (PR #1947), branch `issue-1945-19f1d0d9b4e0`
- Source log (gist): <https://gist.githubusercontent.com/konard/7adca8e346bd071e0b7962e927d708da/raw/c9d12718a5d4daaa5ee702c21b213cf4bf2e76b1/solution-draft-log-pr-1781850499451.txt>
- Local copy of the full log: [`data/solution-draft-log-pr-1781850499451.txt`](./data/solution-draft-log-pr-1781850499451.txt) (52 841 lines)
- Issue + comments snapshots: [`data/issue-1949.json`](./data/issue-1949.json), [`data/issue-1949-comments.json`](./data/issue-1949-comments.json)

## Summary

During a solve run, the Claude CLI returned a transient **HTTP 529 "Overloaded"**
result. Hive-mind's shared retry logic correctly decided to retry (good), but it
also **switched the user's requested `--model` to the configured fallback**
(`opus -> opus-4-7`). A 529 is a _server-wide, transient_ overload — it is **not**
a signal that the selected model is at capacity — so silently downgrading the
model for every overload is wrong: the user asked for `opus`, and overloads should
retry `opus`, not quietly run the rest of the session on a weaker model.

The same log also exposed **two display bugs** that made the behaviour hard to
diagnose: the warning printed the bare alias `opus -> opus-4-7` (ambiguous — which
concrete model is that?), and the per-retry "execution context" block printed
`Model: sonnet` while the command it actually ran used `--model claude-opus-4-7`.
Three different names for one run.

## Timeline (UTC, 2026-06-19)

| Time         | Event                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 05:48:44.611 | Claude CLI emits a `result` event: `is_error: true`, `api_error_status: 529`, `result: "API Error: 529 Overloaded …"`. `total_cost_usd: 0`. |
| 05:48:44.615 | Hive-mind: `⚠️ Detected error from Claude CLI (subtype: success)`.                                                                          |
| 05:48:45.110 | `⚠️ API overload detected. Retry 1/10 in 2 min (session preserved)…` — correct: overload is retryable.                                      |
| 05:48:45.114 | `🔀 Switching to fallback model: opus -> opus-4-7` — **the bug**: a transient 529 mutates the requested `--model`.                          |
| 05:50:45.132 | Retry-attempt context block prints `Model: sonnet` — **display bug**: neither `opus` (requested) nor `opus-4-7` (switched-to).              |
| 05:50:45.207 | Actual retry command: `claude --resume … --model claude-opus-4-7 …` — a **third** name for the same run.                                    |
| 06:42:08     | Issue #1949 filed with the log excerpt and the requirement list.                                                                            |

## Reproducing the failure

The classification bug reproduces in isolation against the shared helper. Before
the fix, `classifyRetryableError('API Error: 529 Overloaded')` returned
`{ isRetryable: true, isCapacity: true }`, and `isCapacity: true` is exactly what
made `maybeSwitchToFallbackModel` mutate `argv.model`:

```js
import { classifyRetryableError, maybeSwitchToFallbackModel } from './src/tool-retry.lib.mjs';

// BEFORE the fix:
classifyRetryableError('API Error: 529 Overloaded'); // → { isRetryable: true, isCapacity: true, ... }

const argv = { model: 'opus', fallbackModel: 'opus-4-7' };
await maybeSwitchToFallbackModel({ tool: 'claude', argv, log, errorMessage: 'API Error: 529 Overloaded' });
// BEFORE: argv.model === 'opus-4-7'  (switched — wrong)
// AFTER : argv.model === 'opus'      (kept — correct)
```

The regression is now pinned by
[`tests/test-issue-1949-overload-no-model-switch.mjs`](../../../tests/test-issue-1949-overload-no-model-switch.mjs)
(13 assertions across classification, no-switch, still-switch-on-real-capacity,
and resolved-ID rendering).

## Requirements (from the issue body)

1. **(R1)** Retryable status/errors (e.g. 529) must **not** switch the `--model`;
   retry the _same_ model. Fallback can be configured inside Claude Code itself
   (its `--fallback-model` flag) — we should not do the fallback switch at our
   `--model` level for transient errors.
2. **(R2)** In warnings/comments, `opus` is ambiguous — show the resolved model
   ID, e.g. `opus -> claude-opus-4-8` (and the fallback's resolved ID too).
   Reference: the confusion in PR #1947's comment.
3. **(R3)** Display the requested model **and the actual thinking level** (if
   possible) in the PR comment.
4. **(R4)** Download all issue logs/data into `docs/case-studies/issue-1949/`,
   write a deep case study (timeline, requirements, root causes, solution plans,
   reuse of existing components, online research).
5. **(R5)** If there is not enough data for the root cause, add debug/verbose
   output (default off) to enable root-cause finding next time.
6. **(R6)** If the issue relates to other repos with issue tracking, file issues
   there with reproducible examples, workarounds and code-fix suggestions.
7. **(R7)** Apply the fix across the **entire** codebase — if the bug exists in
   multiple places, fix all of them.
8. **(R8)** Plan and execute everything in this single PR (#1950).

## Root-cause analysis

Three distinct defects combined in the one log excerpt.

### Root cause #1 — overload (529) was classified as a model-_capacity_ error

`classifyRetryableError` returned `isCapacity: true` for "Overloaded". The
fallback gate keyed off exactly that flag:

```js
// maybeSwitchToFallbackModel (before): switched whenever isCapacity was true
if (!fallbackModel || !classification.isCapacity || !argv?.model) return { switched: false, ... };
argv.model = fallbackModel; // mutates the user's requested model
```

But a 529 is a transient, server-wide overload, not "the selected model is full."
Conflating the two meant **every** overload silently downgraded the model for the
rest of the session.

**Fix:** the overload branch now returns `isCapacity: false` (it stays
`isRetryable: true`). Only a genuine _"the selected model is at capacity"_ message
keeps `isCapacity: true`. The switch gate is unchanged in shape but now fires only
for true capacity errors. The change lives in the **shared**
`src/tool-retry.lib.mjs`, so it applies to every tool that uses the helper
(claude, codex, gemini, qwen, opencode, agent) — satisfying R7 in one place.

### Root cause #2 — fallback warning printed a bare, ambiguous alias

The warning read `🔀 Switching to fallback model: opus -> opus-4-7`. Neither side
shows the concrete model, so a reader of PR #1947's comment could not tell what
`opus` actually resolved to.

**Fix:** a new `formatModelWithResolvedId(model, tool)` renders
`opus (claude-opus-4-8)` (and leaves an already-resolved ID untouched). The switch
warning now reads
`opus (claude-opus-4-8) -> opus-4-7 (claude-opus-4-7)`.

### Root cause #3 — execution-context "Model:" line used a broken heuristic

The verbose retry block computed the model name as:

```js
const modelName = argv.model === 'opus' ? 'opus' : 'sonnet';
```

After root cause #1 switched `argv.model` to `'opus-4-7'`, this ternary fell
through to `'sonnet'`, so the block printed `Model: sonnet` for a run that
actually used `--model claude-opus-4-7`. Even without the switch, this heuristic
mislabels _every_ non-`opus` alias (`sonnet`, `haiku`, `opus-4-7`, full IDs) — it
only ever prints `opus` or `sonnet`.

**Fix:** the block is replaced by a shared `logExecutionContext(...)` helper that
prints `formatModelWithResolvedId(argv.model, tool)`, so the context line always
matches the model actually passed to the CLI (e.g. `opus (claude-opus-4-8)`).

## Requirement R3 — requested model + thinking level in the comment

The PR/issue comment already carried a "Requested model" line; this PR makes it
unambiguous and adds the thinking level:

- `src/config.lib.mjs` gains `describeRequestedThinking(argv)`, which turns the
  CLI thinking flags into a human string, e.g. `high (~23999 tokens)`,
  `medium (~16000 tokens)`, or `off (disabled)` (returns `null` when no thinking
  flag was set, so the line is omitted).
- `src/models/index.mjs` `buildModelInfoString` / `getModelInfoForComment` now
  render the requested model with its resolved ID — `Requested: \`opus\`
  (\`claude-opus-4-8\`)`— and add a`Thinking level:` line when known.
- `src/github.lib.mjs` `attachLogToGitHub` accepts `argv` (and an optional
  explicit `thinkingInfo`) and derives the thinking description via
  `describeRequestedThinking`, threading it into the comment. All nine
  `attachLogToGitHub` call sites pass `argv`.

## R5 — verbose / debug output

The data was sufficient to find all three root causes from the existing log, so no
new always-on debug was required. Two verbose-only aids were nonetheless added for
future iterations (default off, gated behind `--verbose`):

- `logExecutionContext` prints the resolved model up-front for every run.
- `maybeSwitchToFallbackModel` now logs, at verbose level, when it **keeps** the
  requested model on a transient error:
  `Keeping requested model opus (claude-opus-4-8) (transient API overload — no fallback switch, Issue #1949)`.

## R6 — other repositories

The defect is entirely in hive-mind's own retry/display logic
(`src/tool-retry.lib.mjs`, `src/claude.lib.mjs`, `src/models/index.mjs`,
`src/config.lib.mjs`, `src/github.lib.mjs`). The Claude CLI's behaviour (returning
529 and offering `--fallback-model`) is correct and is exactly what we now rely on.
No upstream/third-party issue is warranted; the fix is local.

## Existing components reused (instead of new machinery)

- **`src/tool-retry.lib.mjs`** — the shared classifier + fallback gate already
  existed (issues #1881, #1924, #1937). The fix is a one-flag reclassification
  plus two small helpers in the same file, so all tools inherit it.
- **Claude CLI `--fallback-model`** — the native per-request fallback. Hive-mind
  already auto-populates `argv.fallbackModel` with the default fallback
  (`src/solve.config.lib.mjs`); the claude tool now forwards it as
  `--fallback-model <id>` so transient overloads fall back _inside_ Claude Code
  while our `--model` stays stable.
- **`resolveModelId` / `mapModelForTool`** (`src/models/index.mjs`) — already map
  aliases to full IDs; `formatModelWithResolvedId` just composes them.
- **`getThinkingLevelToTokens` / `getTokensToThinkingLevel`** (`src/config.lib.mjs`)
  — already convert between thinking levels and token budgets;
  `describeRequestedThinking` reuses them.

## Online research

- Anthropic documents **HTTP 529 `overloaded_error`** as a transient,
  server-wide condition ("the API is temporarily overloaded") and advises
  retrying with backoff — confirming it is _not_ model-specific capacity, and that
  retrying the same model is the intended remedy.
- The Claude Code CLI `--fallback-model <model>` flag is designed for exactly this
  case: when the primary model is overloaded it automatically falls back **per
  request** and retries the primary on the next turn — which is why pushing the
  fallback decision down into the CLI (rather than mutating our `--model`) is the
  right architecture.

## Fixes applied in this PR

| File                                  | Change                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/tool-retry.lib.mjs`              | Overload → `isCapacity: false`; add `formatModelWithResolvedId`, `logExecutionContext`; verbose keep-model log. |
| `src/claude.lib.mjs`                  | Use `logExecutionContext` (kills the `=='opus'?:'sonnet'` heuristic); forward `--fallback-model` to the CLI.    |
| `src/models/index.mjs`                | Render requested model with resolved ID; add `Thinking level:` line.                                            |
| `src/config.lib.mjs`                  | Add `describeRequestedThinking(argv)`.                                                                          |
| `src/github.lib.mjs`                  | Thread `argv` / `thinkingInfo` into the comment via `describeRequestedThinking`.                                |
| `src/solve*.mjs` (9 call sites)       | Pass `argv` to `attachLogToGitHub`.                                                                             |
| `tests/test-issue-1949-*`             | New regression test (13 assertions).                                                                            |
| `tests/test-issue-{1881,1924,1937}-*` | Update the "Overloaded" cases to assert `isCapacity === false`.                                                 |
| `docs/case-studies/issue-1949/`       | This case study + raw logs.                                                                                     |
