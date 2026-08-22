# Case Study: Issue #2169 — `❌ Transient API error persisted after 10 retries`

## Summary

Issue [#2169](https://github.com/link-assistant/hive-mind/issues/2169) reported a `/solve`
run that burned nearly four hours and then died with:

```
❌ Transient API error persisted after 10 retries
```

The captured log proves the run **never hit a single API error**. All 11 Claude
invocations ended with `"subtype": "success"`, `"is_error": false` and
`"api_error_status": null`. What the retry loop mistook for a "Gateway error
(502/504/52x)" was the agent's **own success summary**, because the classifier tested
the summary text with a bare `/\b52[0-4]\b/` — and the work being reported was on
`G-Ivan-A/hybrid-Intelligence-lab` **issue #523 / PR #524**. Every successful summary
mentioned `#523` and `#524`, so every success was re-classified as a gateway outage and
re-run, ten times, at a cost of **$7.65** and **3 h 55 min**.

The issue asks for three things, and this PR delivers all three:

1. **Exponential backoff with a configurable total window of up to 12 hours, minimum
   3 minutes** — real provider outages must survive far longer than the previous ~3.5 h
   attempt-capped ceiling.
2. **A deep case study** with the raw data compiled under `docs/case-studies/issue-2169/`
   (this document).
3. **Apply the fix across the entire codebase**, not just the one place it was observed.

## Captured Evidence

| File                                                    | Purpose                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `data/run.log.txt`                                      | The complete 30,806-line start-command log (2.1 MB) from the gist linked in the issue — execution `bb1c1a05-…f2361c` |
| `data/failure-excerpts.txt`                             | The decisive slices: 11 `result` events, their costs/turn counts, 10 retry announcements, the final failure          |
| `data/issue-2169.json`, `data/issue-2169-comments.json` | Issue metadata and comments (`[]` at capture time)                                                                   |
| `data/log-header.txt`                                   | Run header: image `konard/hive-mind-dind:2.12.5`, docker isolation, `--verbose`                                      |
| `data/research-sources.json`                            | Primary/external sources consulted                                                                                   |
| `experiments/issue-2169-replay-log-classification.mjs`  | Replays all 11 captured payloads through the old and new classifier (11/11 retryable → 0/11)                         |

Reproduce the root cause in one command:

```console
$ node experiments/issue-2169-replay-log-classification.mjs
attempt  1: old=RETRY new=ok    52x-hits=["524"] :: Готово. PR: https://github.com/G-Ivan-A/hybrid-Intelligence-lab/pull/5…
…
payloads: 11
classified retryable by OLD matcher: 11
classified retryable by NEW matcher: 0
```

## Timeline (execution `bb1c1a05-5394-4845-a88c-d4ddf9f2361c`)

Start `2026-08-17 20:34:54.454`, finish `2026-08-18 00:29:38.995`, exit code `1` — **3 h 54 min 44 s**,
of which **3 h 30 min was pure sleeping** in retry backoff (2 + 4 + 8 + 16 + 30 × 6 minutes).

| #   | Log line | Claude verdict                                              | `num_turns` | `total_cost_usd` | What the retry loop did                                                           |
| --- | -------- | ----------------------------------------------------------- | ----------- | ---------------- | --------------------------------------------------------------------------------- |
| 1   | 16184    | `success`, `Готово. PR: …/pull/524 …`                       | 58          | $4.113125        | `Retry 1/10 in 2 min` — matched `524`                                             |
| 2   | 17522    | `success`, `Проверил текущее состояние — работа завершена…` | 3           | $1.137712        | `Retry 2/10 in 4 min` — matched `524`, `523`                                      |
| 3   | 19012    | `success`, `The work on issue #523 is complete…`            | 4           | $0.621181        | `Retry 3/10 in 8 min`                                                             |
| 4   | 22343    | `success`, ``…(`463c5ca`, PR #522), so I merged it…``       | 10          | $0.298518        | `Retry 4/10 in 16 min` — matched `522`, `523`, `524`                              |
| 5   | 23361    | `success`, `Nothing has changed since the last check…`      | 2           | $0.320430        | `Retry 5/10 in 30 min` (max delay reached)                                        |
| 6   | 24389    | `success`, `State is unchanged from the previous two…`      | 2           | $0.068062        | `Retry 6/10 in 30 min`                                                            |
| 7   | 26628    | `success`, `…I spent this pass on a self-review…`           | 6           | $0.220802        | `Retry 7/10 in 30 min`                                                            |
| 8   | 27656    | `success`, `Nothing has changed and nothing is left…`       | 2           | $0.076293        | `Retry 8/10 in 30 min`                                                            |
| 9   | 28689    | `success`, `State is identical to the previous four…`       | 2           | $0.387664        | `Retry 9/10 in 30 min`                                                            |
| 10  | 29717    | `success`, `Unchanged again: clean tree…`                   | 2           | $0.070936        | `Retry 10/10 in 30 min`                                                           |
| 11  | 30749    | `success`, `Same result as the previous six checks…`        | 2           | $0.334934        | budget exhausted → line 30764 `❌ Transient API error persisted after 10 retries` |

**Totals:** 11 successful runs, **0** with `api_error_status != null` (verified across
the whole log), $7.6497 spent — $3.5365 of it on the ten pointless repeats. The run then
reported failure and the docker container was kept "for investigation" — the user-visible
symptom in the issue.

Note the contradiction at line 16190–16193, three lines apart:

```
✅ Stream closed normally after result event
   Keeping requested model opus (claude-opus-5) (transient Gateway error (502/504/52x) — no fallback switch, Issue #1949)

⚠️ Gateway error (502/504/52x) detected. Retry 1/10 in 2 min (session preserved)...
   Error: Готово. PR: https://github.com/G-Ivan-A/hybrid-Intelligence-lab/pull/524 (ready for review, …)
```

The stream closed _normally, after a result event_, and the "Error:" the loop printed is
the agent's Russian-language success report.

## Root-Cause Analysis

### RC1 — a bare `/\b52[0-4]\b/` matched ordinary prose

`src/tool-retry.lib.mjs` (pre-fix, line 166 on `main`):

```js
if (lower.includes('502 bad gateway') || … || lower.includes('api error: 504') || /\b52[0-4]\b/.test(lower)) {
  return { message, isRetryable: true, isCapacity: false, label: 'Gateway error (502/504/52x)' };
}
```

The `\b52[0-4]\b` alternative was added for Cloudflare-style bodies (`520 Unknown Error`,
`523 Origin Is Unreachable`) in issue #1955. It has no context requirement, so **any**
standalone 520–524 anywhere in the final message matched: PR numbers, issue numbers, line
numbers, byte counts, timings, commit stats. In this run the target repository's issue was
`#523` and its PR `#524` — a coincidence that made _every single_ summary "retryable".
The replay experiment shows 11/11 payloads matching the old predicate.

### RC2 — the transient-error gate ran even when the run had succeeded

`src/claude.lib.mjs` evaluated `isTransientError` on the terminal result **without asking
whether the run had succeeded**. So even a perfect result — `subtype: success`,
`is_error: false`, `exit code 0`, cost and turns recorded — could be thrown away and
re-run. RC1 supplied the false positive; RC2 turned it into a four-hour loop. Either
defect alone is survivable; together they are a money-burning infinite-ish retry.

### RC3 — the retry window was far too short for a real outage (the issue's own requirement)

Even when the classification is _correct_, the previous policy was:

| Setting               | Before                 | After                                            |
| --------------------- | ---------------------- | ------------------------------------------------ |
| Max transient retries | 10 (hard stop)         | 100 (runaway backstop only)                      |
| Initial delay         | 2 min                  | 3 min                                            |
| Max delay             | 30 min                 | 30 min                                           |
| Minimum delay         | —                      | 3 min (`HIVE_MIND_MIN_TRANSIENT_ERROR_DELAY_MS`) |
| **Total window**      | ~3 h 30 min (implicit) | **12 h, explicit and configurable**              |

10 retries at 2 → 30 min is ≈ 3.5 hours of wall clock, and it was _implicit_: nobody
could read the cap off a config value. Anthropic incidents have exceeded that
([status.anthropic.com](https://status.anthropic.com/)), and the issue explicitly asks
for "up to 12 hours of retries in total (must be configurable), with minimum of
3 minutes".

## The Fixes

### Fix 1 — HTTP status codes only match in an error-ish context (RC1)

`src/tool-retry.lib.mjs` gains an exported helper:

```js
export const matchesHttpStatus = (lowerText, codePattern, phrases = []) => { … };
```

A status code now counts only when it sits next to an error-ish prefix
(`api error: 503`, `status code: 520`, `http 502`, `error 504`, …) or next to a known
gateway phrase (`bad gateway`, `origin is unreachable`, `web server is down`, …). A bare
number in prose never matches. Applied to both the gateway branch (`502|504|52[0-4]`) and
the 503 branch.

### Fix 2 — a successful run is never retried (RC2)

`src/claude.lib.mjs`:

```js
const runProducedSuccess = resultSuccessReceived && !commandFailed && !errorDuringExecution && exitCode === 0;
if (runProducedSuccess && isTransientError) {
  await log(`🔍 Transient-error pattern seen in a successful run — not retrying (Issue #2169). …`, { verbose: true });
}
if (!runProducedSuccess && isTransientError && !subscriptionError) { … }
```

This is defence in depth: even if some future pattern produces another false positive, a
run that Claude itself reported as successful is accepted, and the near-miss is recorded
in verbose output so the next misclassification is diagnosable from the log alone (the
issue's "add debug output … that will allow us to find root cause on next iteration"
requirement).

### Fix 3 — a wall-clock retry budget, not an attempt count (RC3)

New in `src/tool-retry.lib.mjs`:

```js
export const createTransientRetryBudget = ({ budgetMs = retryLimits.transientErrorRetryBudgetMs, now = () => Date.now() } = {}) => ({
  grant, evaluate({ retryCount, maxRetries, initialDelayMs, maxDelayMs, minDelayMs }), describeProgress(), describeExhaustion(decision), …
});
```

`evaluate()` computes the next exponential delay, clamps it to `[minDelayMs, maxDelayMs]`
and refuses only when the delay would run past the remaining budget
(`reason: 'budget'`) or when the runaway backstop is hit (`reason: 'count'`). The attempt
count is demoted to a safety net; the wall clock decides. `describeProgress()` appends
`budget 25 min/12h used` to every retry line, and `describeExhaustion()` produces the
final message, e.g. `retry budget of 12h exhausted after 26 retries over 11h 45m` (or
`retry limit of 100 attempts reached after …` when the backstop fires).

New/changed configuration in `src/config.lib.mjs` — every value overridable by env:

| Env var                                      | Default            | Meaning                                        |
| -------------------------------------------- | ------------------ | ---------------------------------------------- |
| `HIVE_MIND_TRANSIENT_ERROR_RETRY_BUDGET_MS`  | `43200000` (12 h)  | Total wall-clock retry window; `0` = unlimited |
| `HIVE_MIND_MIN_TRANSIENT_ERROR_DELAY_MS`     | `180000` (3 min)   | Floor for every transient wait                 |
| `HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS` | `180000` (3 min)   | First backoff step                             |
| `HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS`     | `1800000` (30 min) | Backoff ceiling                                |
| `HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES`      | `100`              | Runaway backstop                               |

Resulting schedule: `3, 6, 12, 24, 30, 30, 30 …` minutes — ~26 retries inside the 12-hour
window (verified by a simulation test with an injected clock).

### Fix 4 — applied to the entire codebase

The issue requires "if we have issue in multiple places, it should be fixed in all them".
Every tool that owns a transient-retry loop now shares the same budget object:

| File                            | Change                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/claude.lib.mjs`            | success gate + budget on both the result path and the exception path                                                                               |
| `src/agent.lib.mjs`             | budget-driven retries, progress/exhaustion messages                                                                                                |
| `src/gemini.lib.mjs`            | idem                                                                                                                                               |
| `src/qwen.lib.mjs`              | idem                                                                                                                                               |
| `src/codex.lib.mjs`             | idem (two retry blocks)                                                                                                                            |
| `src/opencode.lib.mjs`          | idem                                                                                                                                               |
| `src/claude.connection.lib.mjs` | replaced a local `maxRetries = 3` / `baseDelay` pair with the shared budget via one `retryAfterOverload()` helper used by all three overload sites |

RC2 was verified to be **claude-specific**: `agent`, `gemini`, `qwen`, `codex` and
`opencode` already enter their retry blocks only behind an explicit failure condition
(`exitCode !== 0`, a detected error event, or zero emitted events), so a successful run
could never reach their classifier. RC1 and RC3, in contrast, were shared by all of them
— they all call `classifyRetryableError` and all used the attempt-capped delays — which is
why the budget and the status-context matcher are applied everywhere.

### Fix 5 — diagnosable classification logging (the issue's debug-output requirement)

The reported log made the misclassification impossible to diagnose: the retry line printed
only `lastMessage.substring(0, 200)`, while the `PR #524` token that actually made the
classifier fire sat ~1.6 KB later in the same message. `describeClassificationEvidence()`
(`src/tool-retry.lib.mjs`) now renders, under `--verbose`, the message length and the
±40-character context around every HTTP-status-looking token:

```
   Classification evidence: label="52x gateway error" messageChars=1783 statusTokens=[@1642 "…Opened PR #524 for the fix…"]
```

It is emitted from `src/claude.lib.mjs` both on the retry path and on the new
"transient pattern seen in a successful run" near-miss path, so a future false positive is
identifiable from a single log line without re-running anything.

## Verification

`tests/transient-retry-budget-2169.test.mjs` (27 assertions) covers:

- **False positives** — each of the captured success summaries (`Готово. PR: …/pull/524`,
  `The work on issue #523 is complete…`, ``(`463c5ca`, PR #522)``) classifies as
  **not** retryable.
- **True positives preserved** — `502 Bad Gateway`, `520 Unknown Error`,
  `523 Origin Is Unreachable`, `api error: 503`, `status code: 503`, `504 Gateway Timeout`
  are all still retryable.
- **End-to-end** — `executeClaudeCommand` fed a single `result/success` event whose text
  contains `pull/524` invokes the CLI exactly **once**, returns `success: true`, and emits
  neither `Retry attempt` nor `Transient API error persisted`. This is the regression test
  for the reported failure.
- **Budget behaviour** — defaults; the 3-minute floor; the floor clamped by the max; a
  simulated 12-hour outage granting >20 retries spanning 11–12 h and stopping with
  `reason: 'budget'`; the `3, 6, 12, 24, 30` min schedule; a configurable shorter budget;
  the count backstop (`reason: 'count'`); `budgetMs = 0` → unlimited;
  `formatRetryDuration` rendering.

`tests/test-internal-server-error-retry.mjs` (28) and `tests/test-request-timeout-retry.mjs`
(28) were updated to the new defaults and pass. `npm run lint` is clean.

## Existing Components and Libraries Considered

| Option                                                                                              | Wall-clock budget?                         | Verdict                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`p-retry`](https://github.com/sindresorhus/p-retry) v8                                             | **Yes** — `maxRetryTime` (monotonic clock) | Closest match; our `createTransientRetryBudget` intentionally mirrors its `maxRetryTime` semantics. Not adopted: our loops are recursive `executeWithRetry` calls that mutate session state (`--resume <sessionId>`), swap models, rewrite log files and stream output between attempts — they are not a wrappable `() => Promise` unit. |
| [`cockatiel`](https://github.com/connor4312/cockatiel) v4                                           | No (attempt-based `ExponentialBackoff`)    | Would still need a custom budget policy; adds a dependency for logic we need to own anyway.                                                                                                                                                                                                                                              |
| [`exponential-backoff`](https://github.com/coveo/exponential-backoff) v3                            | No (`numOfAttempts`, `maxDelay`)           | Same limitation as cockatiel.                                                                                                                                                                                                                                                                                                            |
| [`node-retry`](https://github.com/tim-kos/node-retry)                                               | Yes (`maxRetryTime`)                       | The primitive behind p-retry; same integration objection.                                                                                                                                                                                                                                                                                |
| **In-repo** `getRetryDelayMs`, `waitWithCountdown`, `prepareRetryAfterError`, `parseIntWithDefault` | —                                          | **Reused.** The new budget composes with them rather than replacing them, so the countdown UI, capacity fallback (#2037) and env-config conventions are unchanged.                                                                                                                                                                       |

External guidance consulted (see `data/research-sources.json`): Anthropic documents 529
`overloaded_error` as a capacity signal to be retried with exponential backoff; the AWS
"[Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)"
analysis warns that synchronised retries amplify an outage. Our delays are already long
(3–30 min) and a solver run is a single client, so un-jittered backoff is acceptable
today; **adding optional jitter is recorded here as a follow-up**, not a requirement of
this issue.

## Upstream Reporting

The issue asks to file upstream issues if another project is at fault. **No upstream
defect was found**: the log contains zero non-null `api_error_status` values and eleven
`subtype: success` results, so the Anthropic API and the Claude CLI behaved correctly
throughout. The failure was entirely self-inflicted by our classifier, so there is
nothing to report to `anthropics/claude-code` or any other project for _this_ run.
(Existing upstream reports about 529 handling — e.g.
[claude-code#60577](https://github.com/anthropics/claude-code/issues/60577) and
[claude-code#4146](https://github.com/anthropics/claude-code/issues/4146) — already track
the genuine capacity-error behaviour and confirm that the retry policy is the caller's
responsibility, which is what this PR implements.)

## Requirements Checklist

| #   | Requirement (verbatim from the issue)                                                                                       | Status                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "apply exponential backoff here, with up to 12 hours of retries in total (must be configurable), with minimum of 3 minutes" | ✅ `transientErrorRetryBudgetMs` = 12 h (`HIVE_MIND_TRANSIENT_ERROR_RETRY_BUDGET_MS`), floor 3 min (`HIVE_MIND_MIN_TRANSIENT_ERROR_DELAY_MS`) |
| 2   | "download all logs and data related about the issue to this repository … `./docs/case-studies/issue-{id}`"                  | ✅ `data/run.log.txt` (full 2.1 MB log), `data/*`                                                                                             |
| 3   | "deep case study analysis (also … search online for additional facts and data)"                                             | ✅ this document; sources in `data/research-sources.json`                                                                                     |
| 4   | "reconstruct timeline/sequence of events"                                                                                   | ✅ Timeline section, per-attempt with line numbers, turns and cost                                                                            |
| 5   | "list of each and all requirements from the issue"                                                                          | ✅ this table                                                                                                                                 |
| 6   | "find root causes of the each problem"                                                                                      | ✅ RC1 (bare `52[0-4]` regex), RC2 (no success gate), RC3 (window too short)                                                                  |
| 7   | "propose possible solutions and solution plans for each requirement"                                                        | ✅ Fixes 1–4, all implemented in this PR                                                                                                      |
| 8   | "check known existing components/libraries that solve similar problem"                                                      | ✅ p-retry / cockatiel / exponential-backoff / node-retry comparison above                                                                    |
| 9   | "If there is not enough data to find actual root cause, add debug output and verbose mode"                                  | ✅ Root cause was found; verbose near-miss logging + `describeClassificationEvidence()` added anyway (Fix 5)                                  |
| 10  | "If issue related to any other repository/project … report issues on GitHub"                                                | ✅ Investigated — no upstream defect (see Upstream Reporting)                                                                                 |
| 11  | "double check to fully apply requirements to entire codebase … fixed in all them"                                           | ✅ claude, agent, gemini, qwen, codex (×2), opencode, claude.connection                                                                       |
