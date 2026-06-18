# Case Study — Issue #1941: `CLAUDE execution failed with }` (meaningless error fragment on interruption)

- **Issue:** [#1941 — Failed to deliver working session](https://github.com/link-assistant/hive-mind/issues/1941)
- **Pull Request:** [#1942](https://github.com/link-assistant/hive-mind/pull/1942)
- **Reported from:** [G-Ivan-A/hybrid-Intelligence-lab#252 (comment 4741631558)](https://github.com/G-Ivan-A/hybrid-Intelligence-lab/pull/252#issuecomment-4741631558) — `failed by {`
- **Full failure log:** [Gist `91dd416b…`](https://gist.githubusercontent.com/konard/91dd416b5e3bfeaed43ec2b2c1824c78/raw/0fe1f53ab82ba2b5f9995e106e701fb7ea2f08e2/solution-draft-log-pr-1781783305174.txt) (727 KB) — archived at [`data/solution-draft-log.txt`](./data/solution-draft-log.txt)
- **Date analyzed:** 2026-06-18
- **Related prior work:** [#1845](https://github.com/link-assistant/hive-mind/issues/1845) (surface the core error message) — this issue is a direct follow-up.

---

## 1. Requirements extracted from the issue

| #   | Requirement                                                                                                                                      | Status                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| R1  | Download all logs/data about the issue into `./docs/case-studies/issue-1941/` and compile it.                                                    | ✅ [`data/`](./data) (issue JSON, failure comment, full log, error excerpt)                            |
| R2  | Deep case study: reconstruct timeline, list all requirements, find root cause(s), propose solutions/plans, check known libraries; search online. | ✅ This document (§2–§7)                                                                               |
| R3  | If not enough data to find root cause, add debug output / verbose mode for the next iteration.                                                   | ✅ Root cause found from existing logs; verbose tracing already present and was sufficient (see §4)    |
| R4  | If the issue relates to another repository/project, report it there with reproducible examples, workarounds, and fix suggestions.                | ✅ Analyzed — the bug is entirely internal to hive-mind; nothing to report upstream (see §7)           |
| R5  | Apply the fix across the **entire codebase** — if the problem exists in multiple places, fix all of them.                                        | ✅ Shared chokepoint + every tool runner (claude/opencode/gemini/qwen); agent already handled (see §5) |
| R6  | Plan and execute everything in the single PR #1942.                                                                                              | ✅                                                                                                     |

---

## 2. Timeline / sequence of events

Reconstructed from [`data/solution-draft-log.txt`](./data/solution-draft-log.txt). The session was solving **`G-Ivan-A/hybrid-Intelligence-lab` issue #251** (draft PR #252, branch `issue-251-45845bc22310`). All timestamps UTC.

| Time                  | Event                                                                                                                                 | Log evidence                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 11:43:30.676          | `solve.mjs` session starts; log file opened.                                                                                          | line 1                                       |
| 11:43:52              | Branch pushed (`Push exit code: 0`); draft PR #252 created.                                                                           | line 299, 359                                |
| 11:44:11 → 11:48      | Claude CLI streams ~40+ normal `assistant`/`tool` turns, all `"interrupted": false`, doing real work on the target repo.              | lines 506–5470                               |
| 11:48:22.382          | A normal Anthropic API request **succeeds** (`post …/v1/messages succeeded with status 200 in 1786ms`).                               | line 5477                                    |
| 11:48:22.392 → 22.499 | hive-mind's **verbose mode** dumps the raw `Response`/`ReadableStream` object to the log, line by line, ending with a lone `}`.       | lines 5478–5564                              |
| **11:48:23.225**      | **`⚠️ Session interrupted by user (CTRL+C)`** — the process receives SIGINT.                                                          | line 5574                                    |
| 11:48:23.226          | `❌ Claude command failed with exit code 130` (130 = 128 + SIGINT).                                                                   | line 5577                                    |
| 11:48:23.229 →        | Auto-commit of uncommitted changes succeeds; failure logs attached to PR.                                                             | lines 5578+                                  |
| (downstream)          | The GitHub failure comment renders **`CLAUDE execution failed with }`** — the stray `}` captured at interrupt time leaks to the user. | [failure comment](./data/failure-comment.md) |

**Key observation:** the run was **not** an API failure — the last HTTP call returned `200`. The session was **interrupted (CTRL+C, exit 130)** while the verbose logger was mid-way through printing a multi-line object dump. The very last non-JSON line printed before the interrupt was a closing brace `}`, and that single character became the user-facing error.

---

## 3. Reproducing the bug

The bug is the transformation `lastMessage = "}"` → `"CLAUDE execution failed with }"`. It is reproduced deterministically by the unit test [`tests/test-issue-1941-meaningless-error-fragment.test.mjs`](../../../tests/test-issue-1941-meaningless-error-fragment.test.mjs):

```js
// The shape claude.lib.mjs returned when interrupted mid-stream (BEFORE the fix):
const toolResult = { success: false, errorInfo: { message: '}', exitCode: 130 } };
formatToolExecutionFailure({ tool: 'claude', toolResult });
// BEFORE fix → "CLAUDE execution failed with }"
// AFTER  fix → "CLAUDE execution failed"           (junk fragment rejected)
```

Run it with:

```bash
node tests/test-issue-1941-meaningless-error-fragment.test.mjs
```

---

## 4. Root cause analysis

### 4.1 Where the `}` comes from

In `src/claude.lib.mjs`, the stream-reading loop tries to `JSON.parse` each line. When a line is **not** JSON (e.g. one line of a `console.log`-style object dump emitted by `command-stream`'s verbose HTTP logging), it falls into the catch branch and stores the raw line as the "last message":

```js
// src/claude.lib.mjs (the catch branch)
} catch (parseError) {
  // Not JSON or parsing failed, output as-is if it's not empty
  if (line.trim() && !line.includes('node:internal')) {
    await log(line, { stream: 'raw' });
    lastMessage = line;          // <-- a lone "}" lands here
    ...
  }
}
```

During the verbose `Response` object dump, the final non-empty line was just `}`. So `lastMessage === '}'` at the moment the user pressed CTRL+C.

### 4.2 Where it leaked to the user

When the command exits non-zero, the tool runner builds its failure return as:

```text
// BEFORE (src/claude.lib.mjs)
errorInfo: { message: lastMessage || `Claude command failed with exit code ${exitCode}`, exitCode }
```

Because `lastMessage` was the truthy string `"}"`, the `||` fallback was skipped and `"}"` became `errorInfo.message`. The shared error-surfacing chokepoint introduced in issue #1845 (`extractToolErrorCore` → `formatToolExecutionFailure`) then faithfully rendered it as:

```
CLAUDE execution failed with }
```

### 4.3 The two real defects

1. **Meaningless fragments are treated as real errors.** A string containing no letters or digits (`}`, `{`, `,`, `[]`, …) carries no diagnostic value but passed the truthiness check and propagated everywhere.
2. **Interruptions weren't labeled as interruptions.** Exit code 130 (SIGINT/CTRL+C) is a _user/operator interruption_, not a Claude error. The terminal already printed `⚠️ Session interrupted by user (CTRL+C)`, but the structured `errorInfo.message` — the part that reaches the GitHub comment — did not say so. (`src/agent.lib.mjs` already special-cased exit 130; the Claude/OpenCode runners did not.)

### 4.4 Was there enough data? (R3)

Yes. hive-mind's existing verbose tracing captured the full interrupt sequence (lines 5574–5577), the preceding successful HTTP 200, and the object dump that produced the `}`. No additional debug output was needed to find the root cause. The fix itself improves future diagnosis by labeling interrupts explicitly.

---

## 5. The fix (applied across the whole codebase — R5)

Two small, shared helpers in `src/lib.mjs`, then wired into every place that builds a tool-failure message.

### 5.1 `src/lib.mjs` — shared helpers + chokepoint guard

```js
// A fragment with no letters or digits is not a real error message.
export const isMeaningfulErrorText = value => {
  if (!value || typeof value !== 'string') return false;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return false;
  return /[\p{L}\p{N}]/u.test(collapsed);
};

// Choose a clean error message: the tool's own message only when meaningful,
// otherwise an interrupt label (exit 130) or a generic fallback.
export const buildToolErrorMessage = ({ lastMessage, exitCode, fallback, toolLabel = 'Tool' } = {}) => {
  if (isMeaningfulErrorText(lastMessage)) return lastMessage.replace(/\s+/g, ' ').trim();
  if (exitCode === 130) return `${toolLabel} command interrupted (CTRL+C)`;
  return fallback;
};
```

`extractToolErrorCore` (the single chokepoint feeding the GitHub comment, the terminal "Error details:", and retry logic) now rejects meaningless cores, so **even pre-existing/edge call sites that bypass `buildToolErrorMessage` cannot surface a junk fragment**:

```js
if (!rawCore || typeof rawCore !== 'string') return null;
if (!isMeaningfulErrorText(rawCore)) return null; // Issue #1941
```

This is defence-in-depth: the source is cleaned **and** the surface is guarded.

### 5.2 Tool runners

| File                   | Change                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/claude.lib.mjs`   | All three failure-return sites now build `errorInfo.message` via `buildToolErrorMessage({ … toolLabel: 'Claude' })`.                          |
| `src/opencode.lib.mjs` | Failure-return site uses `buildToolErrorMessage`, preferring a meaningful `lastMessage` else the accumulated output, `toolLabel: 'OpenCode'`. |
| `src/gemini.lib.mjs`   | Failure-return site uses `buildToolErrorMessage({ lastMessage: errorText, … toolLabel: 'Gemini' })`.                                          |
| `src/qwen.lib.mjs`     | Failure-return site uses `buildToolErrorMessage({ lastMessage: combinedErrorText \|\| errorMessage, … toolLabel: 'Qwen Code' })`.             |
| `src/agent.lib.mjs`    | Already special-cased exit 130 (`Agent command interrupted (CTRL+C)`) — the pattern this fix generalises. No change needed.                   |
| `src/codex.lib.mjs`    | Reviewed — does not store a raw fall-through line as the error message, and is additionally protected by the §5.1 chokepoint guard.           |

### 5.3 Result

| Scenario                                         | Before                            | After                                                              |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------ |
| CTRL+C interrupt (exit 130), `lastMessage = "}"` | `CLAUDE execution failed with }`  | `CLAUDE execution failed with Claude command interrupted (CTRL+C)` |
| Junk fragment, non-interrupt exit code           | `CLAUDE execution failed with }`  | `CLAUDE execution failed` (clean generic fallback)                 |
| Genuine error (`API Error: Output blocked …`)    | unchanged (already worked, #1845) | unchanged — meaningful text is always preserved                    |

---

## 6. Known components / libraries considered

| Option                                                  | Verdict                                                                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unicode property escapes `/[\p{L}\p{N}]/u` (built-in)   | ✅ Chosen — zero-dependency, correctly handles non-ASCII (Cyrillic/CJK) error text; the target session was Russian-language.                                      |
| `validator.js` / `is-alphanumeric` npm packages         | ❌ Overkill for a one-line predicate; adds a dependency and most are ASCII-only.                                                                                  |
| Stricter JSON-only stream parsing (drop non-JSON lines) | ❌ Too risky — some genuine errors (terms-acceptance prompts, plain `Error:` lines) arrive as non-JSON and must be kept. The fragment filter is the surgical fix. |
| Signal-based exit detection (`exitCode === 130`)        | ✅ Standard POSIX convention (128 + SIGINT) already used by `agent.lib.mjs`; reused for consistency.                                                              |

---

## 7. Upstream / cross-repository reporting (R4)

The bug is **100 % internal to hive-mind**:

- The Anthropic API call **succeeded** (HTTP 200) immediately before the failure — no upstream API fault.
- The `}` originated from hive-mind's own verbose object-dump logging combined with hive-mind's own `lastMessage` capture and failure-message construction.
- The interruption (CTRL+C / SIGINT) is an operator/orchestration event, not a defect in any external project.

There is therefore **no external repository to file an issue against**. The upstream PR comment on `G-Ivan-A/hybrid-Intelligence-lab#252` was merely the _symptom surface_; the fix belongs here.

---

## 8. Files in this case study

| Path                                                           | Description                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`data/issue-1941.json`](./data/issue-1941.json)               | The GitHub issue payload (title, body, author, labels).                                         |
| [`data/failure-comment.md`](./data/failure-comment.md)         | The upstream `🚨 Solution Draft Failed` comment showing `CLAUDE execution failed with }`.       |
| [`data/solution-draft-log.txt`](./data/solution-draft-log.txt) | The complete 5,617-line failure log from the Gist.                                              |
| [`data/error-excerpt.txt`](./data/error-excerpt.txt)           | The key log lines: the HTTP-200 success, the object dump, and the CTRL+C interrupt at exit 130. |
