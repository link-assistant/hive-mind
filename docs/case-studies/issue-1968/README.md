# Case Study — Issue #1968

> **CODEX execution failed with `Cannot read properties of null (reading 'type')`**

- **Issue:** [link-assistant/hive-mind#1968](https://github.com/link-assistant/hive-mind/issues/1968)
- **Pull Request:** [link-assistant/hive-mind#1969](https://github.com/link-assistant/hive-mind/pull/1969)
- **Tool:** OpenAI Codex (`--tool codex`), Codex CLI `v0.141.0`, model `gpt-5.5`
- **solve version:** `v2.0.13`
- **Captured run:** solving [xlabtg/teleton-plugins#196](https://github.com/xlabtg/teleton-plugins/issues/196) (the crash is in **our** tool, not in teleton-plugins)
- **Severity:** High — a single echoed source line deterministically aborts the entire solve.

---

## 1. Artifacts compiled in this folder

| File                                                                                   | Description                                                                                                      |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`solution-draft-log-pr-1782068895967.txt`](./solution-draft-log-pr-1782068895967.txt) | The full verbose `solve` log captured for the failing run (5,311 lines). Source: the gist linked from the issue. |
| `README.md`                                                                            | This analysis.                                                                                                   |

Reproduction script: [`experiments/repro-issue-1968.mjs`](../../../experiments/repro-issue-1968.mjs)
Regression test: [`tests/test-issue-1968-codex-null-event.mjs`](../../../tests/test-issue-1968-codex-null-event.mjs)

---

## 2. Timeline / sequence of events

All timestamps from the captured log (`solution-draft-log-pr-1782068895967.txt`).

| Time (UTC)            | Log line  | Event                                                                                                                                                               |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `19:06:11.459`        | 1         | `solve v2.0.13` starts: `solve …/teleton-plugins/issues/196 --think max --tool codex --attach-logs --verbose --no-tool-check --disable-report-issue --language ru`. |
| `19:06:18`            | —         | Preflight checks pass (disk, memory, Playwright MCP).                                                                                                               |
| `19:06:19`–`19:08:13` | —         | Codex CLI `v0.141.0` (`gpt-5.5`) explores the repo, runs many `command_execution` items reading plugin source files.                                                |
| `19:08:13.593`        | 5240      | Codex starts `item_25`: `/bin/bash -lc "sed -n '760,1340p' plugins/composio-direct/index.js"`.                                                                      |
| `19:08:13.594`        | 5254      | Codex emits a `codex_otel.log_only` telemetry event that **echoes the command's stdout** (the `Output:` block) back into the stream.                                |
| `19:08:13.595`        | 5276–5283 | The echoed source includes `getApiKey()`, whose `?? null` fallback puts a bare **`null`** token on its own line (log **line 5282**).                                |
| `19:08:13.597`        | 5305      | **`❌ Error executing Codex command: Cannot read properties of null (reading 'type')`** — the solve aborts.                                                         |
| `19:08:13.620`        | 5311      | `📄 Attaching failure logs to Pull Request…` — run ends in failure.                                                                                                 |

The crash happens **~2 minutes** into an otherwise healthy run. Nothing was wrong with the task, the network, the model, or the target repo — a perfectly valid line of JavaScript source code crashed our stream parser.

---

## 3. Root cause

### 3.1 The echoing mechanism (same as issue #1955)

The Codex CLI prints OpenTelemetry traces to its output stream
(`codex_otel.log_only`, `event.name="codex.tool_result"`). These traces contain a
raw `Output:` dump of the stdout of **every command the agent runs**. So when the
agent ran `sed -n '760,1340p' plugins/composio-direct/index.js`, the _contents of
that source file_ were streamed back to us interleaved with genuine Codex NDJSON
events. This is the exact same root mechanism behind
[issue #1955](../issue-1955) (echoed fixture content mis-parsed as a stream error).

### 3.2 The poisoned line

`plugins/composio-direct/index.js` contained a textbook nullish-coalescing fallback:

```js
function getApiKey() {
  const fromSecrets = sdk.secrets?.get?.('composio_api_key');
  if (typeof fromSecrets === 'string' && fromSecrets.length > 0) return fromSecrets;
  return (
    process.env.COMPOSIO_DIRECT_COMPOSIO_API_KEY ?? process.env.COMPOSIO_API_KEY ?? null // <-- this line, echoed back, is the trigger
  );
}
```

The `null` token sits on its own line. When echoed into our stream and processed by
`parseCodexExecJsonOutput`, that line was `.trim()`-ed to the string `"null"`.

### 3.3 The unguarded property access

`src/codex.lib.mjs` → `parseCodexExecJsonOutput()` parsed each line like this
(before the fix):

```js
let data;
try {
  data = sanitizeObjectStrings(JSON.parse(line));   // JSON.parse('null') === null
} catch {
  continue;                                          // only catches *parse* errors
}

const eventType = typeof data.type === 'string' ? data.type : 'unknown';  // 💥 data is null
```

- `JSON.parse('null')` is **valid JSON** and returns the value `null` — it does **not** throw, so the `try/catch` does not trigger.
- `sanitizeObjectStrings(null)` returns `null` (it only transforms strings/arrays/objects).
- The very next statement reads `data.type`. Reading a property of `null` throws:
  **`Cannot read properties of null (reading 'type')`**.

Because this throw is **outside** the `try`, it propagated all the way up to
`executeCodexCommand`'s top-level handler (`src/codex.lib.mjs:~1370`), which logged
`❌ Error executing Codex command: …` and aborted the solve.

### 3.4 Why a "transient-looking" error is actually deterministic

The error message looks like a generic JS `TypeError` that might be retried, but it
is **100% deterministic** for this input: any time the agent prints a standalone
`null` (or any bare JSON primitive — `42`, `true`, `"text"`, `[…]`) the same crash
occurs. Retrying cannot help; the run is dead until the parser is hardened.

### 3.5 Confirmed reproduction

```text
$ node experiments/repro-issue-1968.mjs   # before the fix
CRASH: Cannot read properties of null (reading 'type')

$ node experiments/repro-issue-1968.mjs   # after the fix
OK — no crash. eventCounts = {"item.started":1,"turn.completed":1}
   turn.completed accounted: true
```

---

## 4. Requirements extracted from the issue

| #   | Requirement                                                                                                                                                | Status                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Download all logs/data related to the issue into `docs/case-studies/issue-1968/`.                                                                          | ✅ Done (this folder).                                                                                                                                            |
| R2  | Compile a deep case study: timeline, full requirement list, root cause per problem, proposed solutions, and relevant existing libraries/components.        | ✅ This document.                                                                                                                                                 |
| R3  | Search online for additional facts/data.                                                                                                                   | ✅ §7.                                                                                                                                                            |
| R4  | If there is not enough data to find the root cause, add debug output / verbose mode for the next iteration.                                                | ✅ Not needed — root cause found from the captured verbose log; the existing `--verbose` log already pinpointed the trigger (line 5282). No new tracing required. |
| R5  | Find the root cause of each problem.                                                                                                                       | ✅ §3.                                                                                                                                                            |
| R6  | Fix the bug in **all** places in the codebase that share the defect.                                                                                       | ✅ §5 — fixed in `codex.lib.mjs` (the crash) plus the same NDJSON-parser class in `claude.lib.mjs`, `agent.lib.mjs`, and `opencode.lib.mjs`.                      |
| R7  | If the issue relates to another repository where we can report bugs, file an issue there with reproducible example, workaround, and a code-fix suggestion. | ✅ §6 — analysis shows the defect is entirely in hive-mind; teleton-plugins did nothing wrong, so no external bug report is warranted.                            |
| R8  | Add a reproducible example and an automated test.                                                                                                          | ✅ `experiments/repro-issue-1968.mjs` + `tests/test-issue-1968-codex-null-event.mjs`.                                                                             |
| R9  | Do everything in the single PR #1969.                                                                                                                      | ✅                                                                                                                                                                |

---

## 5. The fix

**Invariant:** a real Codex/Claude/Agent/OpenCode stream event is _always_ a JSON
object. Any line that parses to a bare `null` or a non-object JSON primitive is not
an event and must be ignored — never dereferenced.

Every NDJSON stream parser now skips non-object parses right after `JSON.parse`:

```js
if (data === null || typeof data !== 'object') continue;
```

### Sites fixed

| File                   | Location                                              | Notes                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/codex.lib.mjs`    | `parseCodexExecJsonOutput()`                          | **The crash.** Guard added immediately after `JSON.parse`, before the first `data.type` read.                                                                          |
| `src/codex.lib.mjs`    | streaming `interactiveHandler`/`progressMonitor` loop | Guarded so handlers never receive a non-object event.                                                                                                                  |
| `src/claude.lib.mjs`   | stdout NDJSON loop                                    | Guard added (was crash-safe via `try/catch` but would silently drop the line).                                                                                         |
| `src/claude.lib.mjs`   | trailing-buffer result parse                          | `data?.type` optional chaining (non-loop block).                                                                                                                       |
| `src/agent.lib.mjs`    | stdout loop, stderr loop, `detectAgentErrors()`       | Three guards. In `opencode`/`agent` the parse + property access shared one `try`, so a bare-`null` line could abort the **rest of the chunk** (lost token accounting). |
| `src/opencode.lib.mjs` | stdout loop + stderr loop                             | Two guards.                                                                                                                                                            |

`src/agent-token-usage.lib.mjs` already guards via `if (!line.startsWith('{')) continue;`
and `accumulateAgentStepFinishUsage` already uses `data?.type`, so they were safe.

### Verification

- `node experiments/repro-issue-1968.mjs` → no crash.
- `node tests/test-issue-1968-codex-null-event.mjs` → 9 passing assertions.
- `node tests/test-issue-1955-codex-fixture-false-positive.mjs` → 23/23 (no regression).
- `node tests/test-codex-support.mjs` → 39/39.
- `npm run lint` and `prettier --check` clean.

---

## 6. Is another repository involved?

**No external bug report is warranted.** The crash is entirely inside hive-mind's
stream parser. `plugins/composio-direct/index.js` in `xlabtg/teleton-plugins` is
**valid, idiomatic JavaScript** — `?? null` is a normal fallback. The only thing it
did "wrong" was contain the word `null` on its own line, which any source file might.

One could argue the Codex CLI _echoing command stdout into its own structured event
stream_ is itself fragile (it is what makes both #1955 and #1968 possible), but that
is documented telemetry behavior, and a robust consumer must tolerate arbitrary
echoed bytes regardless. The correct and sufficient fix is on our side: **never trust
a stream line to be a JSON object before dereferencing it.**

---

## 7. Online research / prior art

- **MDN — `JSON.parse()`**: `JSON.parse('null')` returns the value `null` (a valid
  JSON literal). It does not throw, which is precisely why the `try/catch` around the
  parse did not protect the subsequent property access.
- **`TypeError: Cannot read properties of null (reading 'x')`** is the standard V8/Node
  message for dereferencing `null`. The fix pattern is a type guard or optional
  chaining (`?.`) before the access — both used here.
- **NDJSON / JSON Lines** (<https://jsonlines.org/>): each line is an independent JSON
  value. The spec permits _any_ JSON value per line, including bare `null`/numbers, so
  a parser of a "JSON-object event stream" must explicitly reject non-objects rather
  than assume every parsed line is an object.
- **Prior internal art — issue #1955** ([case study](../issue-1955)): the identical
  echo mechanism produced a _false-positive error_ (an echoed `{"type":"error",…}`
  fixture line). #1968 is the more severe sibling: an echoed bare `null` produces a
  hard _crash_. Both are resolved by treating echoed stdout as untrusted.

### Existing components / libraries considered

- The repo already centralises Unicode hygiene in `sanitizeObjectStrings`
  (`src/unicode-sanitization.lib.mjs`). It correctly passes `null` through unchanged —
  it is not the place for an "is this an event?" guard, so the guard lives at each
  call site instead.
- A shared `parseStreamEventLine(line)` helper returning `object | null` was
  considered to DRY the four parsers. It was rejected for this PR to keep the change
  minimal and low-risk (each call site has slightly different surrounding logic and
  `claude.lib.mjs` is already at its 1500-line lint cap). The one-line guard is
  identical and self-documenting at every site; extraction can be a follow-up.

---

## 8. Prevention

- The regression test `tests/test-issue-1968-codex-null-event.mjs` asserts that bare
  `null`, other JSON primitives, and a realistic echoed-source chunk never crash the
  Codex parser while surrounding events are still accounted for.
- The guard pattern (`if (data === null || typeof data !== 'object') continue;`) is now
  applied consistently across all four agent stream parsers, so a future parser added
  by copy-paste inherits the safe shape.
