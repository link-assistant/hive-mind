# Case study — Issue #2141: "AGENT execution failed with Agent reported error: [object Object]"

> A `solve --tool agent --model formal-ai` run on
> [formal-ai#927](https://github.com/link-assistant/formal-ai/pull/927) died
> **22 seconds** after it started and published exactly one artefact: a
> "🚨 Solution Draft Failed" comment whose entire diagnosis was
>
> ```text
> AGENT execution failed with Agent reported error: [object Object]
> ```
>
> `--attach-logs` was not enabled, the container is gone, and so this string is
> the **only surviving record of the run**. The cause of the failure is
> unrecoverable — not because the tool did not report it, but because Hive Mind
> interpolated the tool's structured error _object_ into a template literal and
> JavaScript rendered it as `[object Object]`.
>
> That is a one-line bug with a disproportionate cost: the same defect class was
> present in **nine** places across six adapters, and one of those places
> (`codex.lib.mjs`) did not merely garble the message — it **dropped the failure
> entirely** and let the run be reported as a success.

- **Issue:** https://github.com/link-assistant/hive-mind/issues/2141
- **PR:** https://github.com/link-assistant/hive-mind/pull/2143
- **Raw data:** [`raw/`](./raw) — issue/PR/comment JSON, verbatim
  `@link-assistant/agent` 0.25.5 source excerpts, and the NDJSON captured from
  two live probes of that CLI.
- **Analysis output:** [`analysis/`](./analysis) — the recorded reproduction and
  the codebase-wide audit table.
- **Reproduction:** [`experiments/issue-2141`](../../../experiments/issue-2141)
- **Failing binary:** `solve v2.11.11`, `@link-assistant/agent` 0.25.5
  (published 2026-07-31), `--tool agent --model formal-ai`.

---

## 1. Timeline

| When (UTC)            | Event                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-04 03:59:39Z  | formal-ai PR [#927](https://github.com/link-assistant/formal-ai/pull/927) ("Require tool-result evidence before general-change completion") is created for issue [#905](https://github.com/link-assistant/formal-ai/issues/905).                                                                       |
| 2026-08-04 04:04:55Z  | `solve` starts continuing PR #927 with `--tool agent --model formal-ai`, **without** `--attach-logs`. It converts the PR to draft and posts the "🤖 AI Work Session Started" comment ([raw](./raw/formal-ai-pr-927-session-start-comment.json)).                                                       |
| 2026-08-04 ~04:05:0xZ | The agent CLI emits a `{"type":"error", …}` record on its JSON stream. Hive Mind's streaming detector stores `data.message \|\| data.error` — the payload is an **object**, so the stored "message" is an object.                                                                                      |
| 2026-08-04 04:05:17Z  | 22 seconds after start, `solve` gives up and posts "🚨 Solution Draft Failed" with **Reason: `AGENT execution failed with Agent reported error: [object Object]`** and the line "Logs were not attached because `--attach-logs` was not enabled." ([raw](./raw/formal-ai-pr-927-failure-comment.json)) |
| 2026-08-04 14:36:55Z  | Issue [#2141](https://github.com/link-assistant/hive-mind/issues/2141) is filed against Hive Mind.                                                                                                                                                                                                     |
| 2026-08-05            | This PR: reproduction, shared renderer, nine-site fix, upstream reports.                                                                                                                                                                                                                               |

**What the 22 seconds tell us.** The run failed almost immediately — before any
model work could have happened. Combined with `--model formal-ai` (which points
the agent CLI at a local Formal AI server on `http://127.0.0.1:8080`), the two
plausible causes are a provider/model initialisation failure or a refused
connection to that server. **We cannot tell which**, and that is precisely the
finding of this case study: the message that would have distinguished them was
destroyed at the moment it was formatted.

## 2. Root causes

### RC1 — a structured error object interpolated into a string (the reported symptom)

`@link-assistant/agent` publishes errors as objects, not strings. From
[`raw/agent-cli-0.25.5-excerpts.md`](./raw/agent-cli-0.25.5-excerpts.md),
`src/cli/cmd/run.ts`:

```ts
if (outputJsonEvent('error', { error: props.error })) continue;
```

and `props.error` is `NamedError.toObject()` — `{ name, data }` — so the record
on the wire is:

```json
{ "type": "error", "sessionID": "ses_…", "error": { "name": "RetryTimeoutExceededError", "data": { "message": "Retry timeout exceeded after 604800s" } } }
```

Hive Mind v2.11.11 consumed it in two places, `src/agent.lib.mjs:671`
(streaming) and `:773` (`detectAgentErrors`, post-hoc):

```js
streamingErrorMessage = data.message || data.error || raw.substring(0, 100);
…
return { detected: true, type: 'AgentError', match: msg.message || msg.error || JSON.stringify(msg).substring(0, 100) };
```

The record has no top-level `message`, so `data.error` — the object — wins.
It is then interpolated at `src/agent.lib.mjs:937`:

```js
errorInfo.message = `Agent reported error: ${outputError.match}`;
```

`${object}` calls `Object.prototype.toString` → `[object Object]`, and
`formatToolExecutionFailure` faithfully published the result. Note the bitter
detail: the `|| JSON.stringify(msg)` fallback that _would_ have preserved the
diagnosis was unreachable, because the object is truthy.

Reproduction (`node experiments/issue-2141/reproduce-object-object.mjs`, recorded
in [`analysis/reproduce-object-object.txt`](./analysis/reproduce-object-object.txt)):

```
BEFORE
  published reason  : AGENT execution failed with Agent reported error: [object Object]   ← issue #2141
AFTER
  published reason  : AGENT execution failed with Agent reported error: RetryTimeoutExceededError: Retry timeout exceeded after 604800s
```

### RC2 — the same defect class in eight more places

`[object Object]` in the agent adapter was the _reported_ instance, not the only
one. The full audit is in [`analysis/adapter-audit.md`](./analysis/adapter-audit.md):
`claude.lib.mjs` (2 sites), `interactive-codex-events.lib.mjs`,
`gemini.lib.mjs`, `cancelled-ci-rerun.lib.mjs`, and — worst —
`codex.lib.mjs`, which guarded with `typeof data.message === 'string'` and
therefore **silently discarded** object-shaped `error` / `turn.failed` events. A
discarded `turn.failed` is not a garbled failure; it is a failure reported as a
success. `qwen.lib.mjs` had the correct behaviour already, via a _private_ copy
of a stringifier the other five adapters could not see — which is exactly how a
defect survives being fixed once.

### RC3 — the publishing path trusted whatever it was given

`isMeaningfulErrorText` / `extractToolErrorCore` in `src/lib.mjs` decide whether
a tool error is worth appending to `"AGENT execution failed"`. They tested for
non-empty text containing letters. `[object Object]` passes that test: it is
non-empty and has letters, while carrying zero information. There was no
backstop between a garbled message and a public GitHub comment.

### RC4 — the failure comment was the only record, and it did not say how to get more

The comment ended with a flat statement of fact — "Logs were not attached
because `--attach-logs` was not enabled." — and no instruction. A reader (human
or the next AI iteration) is left without the one action that makes the next
occurrence diagnosable.

### RC5 — upstream: the agent CLI can fail without emitting a failure

Two behaviours of `@link-assistant/agent` 0.25.5, both reproduced locally with
[`experiments/issue-2141/probe-agent-cli.sh`](../../../experiments/issue-2141/probe-agent-cli.sh):

- **Exit 0 on a fatal startup error.** `echo "say hi" | agent --model nonexistent-provider/nope --output-format json`
  prints `ProviderModelNotFoundError` on stderr
  ([raw](./raw/agent-0.25.5-unknown-model-stderr.txt)), emits **zero**
  `{"type":"error"}` records across 583 stdout records
  ([raw](./raw/agent-0.25.5-unknown-model-stdout.ndjson)) — only a
  `{"type":"log","level":"error","service":"session.prompt","error":"ProviderModelNotFoundError"}`
  record — and **exits 0**. Hive Mind therefore reported a successful, empty
  run. This is a regression of upstream
  [agent#22](https://github.com/link-assistant/agent/issues/22), closed
  2025-12-09.
- **Unbounded retry against an unreachable provider.** `--model formal-ai` with
  nothing listening on `127.0.0.1:8080` produces `AI_APICallError` /
  `ConnectionRefused` with `isRetryable: true` and retries against a configured
  `retryTimeout: 604800` seconds — **7 days**
  ([raw](./raw/agent-0.25.5-formal-ai-unreachable-errors.json)). A connection
  refused to `127.0.0.1` is not a transient condition worth a week of retries.

Neither behaviour caused _this_ incident's message, but both are reachable from
the exact command that produced it, and both are invisible to the caller.

### RC6 — the JSON error event has no human-readable field at all

This is the upstream half of RC1. `run.ts` **already computes** the readable
string one line above the emit:

```ts
let err = String(props.error.name);
if ('data' in props.error && props.error.data && 'message' in props.error.data) err = String(props.error.data.message);
errorMsg = errorMsg ? errorMsg + EOL + err : err;
if (outputJsonEvent('error', { error: props.error })) continue; // ← `err` is not included
UI.error(err);
```

`err` is used for the human TTY path and thrown away on the JSON path. Every
JSON consumer of the agent CLI has to re-derive it, and each one that forgets
produces `[object Object]`.

## 3. Requirements from the issue, and how each is addressed

| #   | Requirement (from [the issue](https://github.com/link-assistant/hive-mind/issues/2141))                              | Status | Where                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Download all logs and data related to the issue into this repository                                                 | Done   | [`raw/`](./raw) — issue/PR/comment JSON, agent CLI source excerpts, live probe NDJSON. The original run log does not exist: `--attach-logs` was off and the container is gone (see RC4).       |
| R2  | Compile it under `./docs/case-studies/issue-2141`                                                                    | Done   | this file, [`raw/`](./raw), [`analysis/`](./analysis)                                                                                                                                          |
| R3  | Deep case-study analysis; search online for additional facts                                                         | Done   | §2 and §5; upstream issue search surfaced [agent#22](https://github.com/link-assistant/agent/issues/22) as a closed-but-recurring precedent                                                    |
| R4  | Reconstruct the timeline / sequence of events                                                                        | Done   | §1                                                                                                                                                                                             |
| R5  | List each and every requirement from the issue                                                                       | Done   | this table                                                                                                                                                                                     |
| R6  | Find the root cause of each problem                                                                                  | Done   | §2 (RC1–RC6)                                                                                                                                                                                   |
| R7  | Propose solutions and solution plans for each requirement                                                            | Done   | §4                                                                                                                                                                                             |
| R8  | Check known existing components/libraries that solve a similar problem                                               | Done   | §5                                                                                                                                                                                             |
| R9  | If there is not enough data to find the actual root cause, add debug output and a verbose mode                       | Done   | the agent adapter now logs the **raw** error and fatal-log records as JSON under `--verbose`, so the next occurrence carries its own evidence even if the rendering is imperfect               |
| R10 | Report related issues to `link-assistant/formal-ai` so `--attach-logs` is used next time                             | Done   | §6                                                                                                                                                                                             |
| R11 | File issues on any other affected repository, with reproducible examples, workarounds and code-level fix suggestions | Done   | §6 — two issues on `link-assistant/agent` (RC5, RC6), each with a runnable probe and a patch sketch                                                                                            |
| R12 | Ensure Formal AI uses Hive Mind so that failing fast + failure logs enable self/auto learning                        | Done   | RC5's fail-fast detector (exit 0 + no model started ⇒ failure), plus §6's `--attach-logs --verbose` recommendation; a failure whose reason is `[object Object]` is unlearnable by construction |
| R13 | Apply the requirements to the entire codebase — fix every occurrence, not just the reported one                      | Done   | [`analysis/adapter-audit.md`](./analysis/adapter-audit.md): 9 sites in 6 files + 3 defence-in-depth guards                                                                                     |
| R14 | Plan and execute everything in one pull request                                                                      | Done   | [#2143](https://github.com/link-assistant/hive-mind/pull/2143)                                                                                                                                 |

## 4. Solutions implemented

1. **One shared renderer — `src/error-text.lib.mjs`.** `stringifyErrorValue()`
   and `firstErrorText()` render strings, `Error` instances, `NamedError`
   `{name, data:{message}}` payloads, nested `{error:{…}}` envelopes and arrays
   into one readable line; they are circular-safe, depth-limited, truncate at
   2000 characters, and never return a placeholder. A single implementation is
   the point: RC2 happened because `qwen.lib.mjs` fixed it privately.
2. **All nine sites routed through it** (agent ×2, claude ×2, codex, gemini,
   qwen, interactive-codex, cancelled-CI). For codex this also _restores_ lost
   failures rather than merely reformatting them.
3. **Defence in depth in the publishing path.** `isPlaceholderErrorText()` now
   backs `isMeaningfulErrorText`, and `extractToolErrorCore` drops a core that
   embeds `[object Object]`. Any site this audit missed degrades to the honest
   `AGENT execution failed` instead of the misleading long form.
4. **Fail fast on the silent startup failure (RC5).** `detectFatalAgentLogRecord`
   recognises `ProviderModelNotFoundError` / `ProviderInitError` /
   `NoSuchModelError` / "failed to initialize … model" log records; if the CLI
   then exits 0 **with no error event and no text output**, the run is failed
   with that message. The `!lastTextContent` guard preserves the issue #1276
   recovery semantics (an agent that recovered and produced output is still a
   success).
5. **Verbose raw evidence (R9).** `--verbose` now dumps the untouched JSON of
   every error record and fatal log record, so the next incident is diagnosable
   from the log even if a future payload shape defeats the renderer.
6. **An actionable failure comment (RC4).** When logs were not attached the
   comment now says so _and_ states that this comment is the only surviving
   record, and to rerun with `--attach-logs --verbose`.
7. **Regression tests.** `tests/test-issue-2141-error-text.mjs` — 26 tests
   across the helper, five adapters, the publishing path and the failure
   comment, each asserting the absence of `[object Object]` on the verbatim
   0.25.5 payload shapes. `tests/test-agent-error-detection.mjs` now imports the
   real detector instead of a local copy of it (the copy is why the defect was
   invisible to that suite).

## 5. Survey of existing components that solve this problem

| Component                                                                                                       | What it does                                                                           | Why it was not adopted here                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:util.inspect` / `format('%o')`                                                                            | Renders any value without `[object Object]`                                            | Optimised for developer inspection, not for a GitHub comment: it prints `{ name: 'X', data: { message: 'Y' } }` rather than `X: Y`, and has no notion of "which field is the message". Used conceptually, not literally.                          |
| `serialize-error` (npm)                                                                                         | Converts `Error`s (and cycles) to plain JSON and back                                  | Solves the _serialize_ direction; we need _object → one readable line_. Also a new runtime dependency in a repo that deliberately keeps them few.                                                                                                 |
| `pretty-error`, `youch`, `verror`                                                                               | Human-friendly rendering of `Error` objects / error chains                             | All assume real `Error` instances. Our payloads are plain JSON that has crossed a process boundary and is no longer an `Error`.                                                                                                                   |
| `AggregateError` / `Error.cause` (ES2022)                                                                       | Standard nesting of causes                                                             | The right shape for _producing_ errors, and worth adopting upstream; it does not help a consumer parsing someone else's JSON.                                                                                                                     |
| RFC 9457 "Problem Details for HTTP APIs"                                                                        | A standard envelope with a mandatory human-readable `title`/`detail`                   | Exactly the right principle, and the basis of the upstream suggestion in §6 (add a top-level `message` string to the error event). Not adoptable unilaterally by the consumer.                                                                    |
| Existing in-repo precedent: `qwen.lib.mjs`'s local `stringifyErrorValue`, `codex.lib.mjs`'s `safeJsonStringify` | Already-proven rendering logic in this codebase                                        | **Adopted** — `src/error-text.lib.mjs` generalises the qwen implementation and its circular-safety, then replaces the private copy.                                                                                                               |
| ESLint `restrict-template-expressions` (typescript-eslint)                                                      | Makes `${object}` a compile error — the mechanical prevention of this entire bug class | Requires type information; this repo is plain `.mjs` with no TypeScript checker. The regression tests plus the `isPlaceholderErrorText` guard are the achievable equivalent. A future `// @ts-check` migration would make this rule the real fix. |

## 6. Reports filed on other repositories (R10, R11)

| Repository                                                                               | Report                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`link-assistant/agent#289`](https://github.com/link-assistant/agent/issues/289)         | **JSON `error` events carry an object with no human-readable field** (RC6). Includes the verbatim record shape, the three-line `run.ts` patch that would include the already-computed `err` string, and the consumer-side workaround now shipped in `src/error-text.lib.mjs`.       |
| [`link-assistant/agent#290`](https://github.com/link-assistant/agent/issues/290)         | **Exit code 0 on a fatal startup error** (RC5) — a reproduction of the closed [agent#22](https://github.com/link-assistant/agent/issues/22) on 0.25.5, with the 583-record NDJSON showing zero error events, plus the unbounded `ConnectionRefused` retry (`retryTimeout: 604800`). |
| [`link-assistant/formal-ai#973`](https://github.com/link-assistant/formal-ai/issues/973) | **Run `solve` with `--attach-logs --verbose`** for automated sessions on that repository, so a failed run leaves evidence behind rather than a single line in a comment (RC4, R10, R12).                                                                                            |

All three were filed on 2026-08-05 from the evidence in [`raw/`](./raw).

## 7. Lessons

- **A truthy fallback is not a fallback.** `a || b || JSON.stringify(x)` cannot
  reach `JSON.stringify` when `b` is an object — the safety net was written, and
  never armed.
- **Fixing a bug in one adapter fixes it in one adapter.** `qwen.lib.mjs` had
  the correct code the whole time. Six adapters, one shared helper.
- **A type check that skips is worse than one that garbles.** `typeof x ===
'string'` turned codex failures into successes; `[object Object]` at least
  told us something went wrong.
- **The failure comment is a log of last resort.** When `--attach-logs` is off,
  it is the entire post-mortem. It must therefore carry both the real reason and
  the instruction for getting more next time.
