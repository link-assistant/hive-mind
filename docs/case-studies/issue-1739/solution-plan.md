# Solution Plan — Issue #1739

This document maps each root cause to one or more concrete fixes, ranked by _blast radius / effort_. The final section lists which of these are implemented in PR #1740 vs. left as follow-ups.

Legend:

- 🔴 **Critical** — blocks recurrence
- 🟠 **High** — meaningful mitigation
- 🟡 **Medium** — improves diagnosis only
- 🔵 **Defensive** — guardrail / cost ceiling

---

## S-1 — Detect and abort "stuck-watch" pattern at the harness layer 🔴

**Targets:** RC-1, RC-3

**Mechanism:** classify a `result.end_turn` event as "passive" when _all_ of the following hold:

1. Session emitted ≥ 1 `run_in_background: true` Bash task.
2. Final assistant `text` content matches a passive-watch regex, e.g.
   `/(wait|wait for|i'?ll wait|i'?ll be notified|once.*completes|when.*completes)/i`
   AND text length is below a threshold (e.g. 200 chars).
3. No `git diff` between `HEAD` at session-start and `HEAD` at `result` time _except_ for files matching a regenerated-artefact denylist (e.g. `deno.lock`, `package-lock.json`, `bun.lockb`, `Cargo.lock`).
4. At least one `task_started` had no matching `task_completed` in the JSONL stream.

**On detection:**

- Log a `🛑 STUCK-WATCH DETECTED` line listing the surviving background-task IDs and the assistant text that triggered the heuristic.
- Mark the session as `stuck_watch_detected = true`. The auto-restart logic (`src/claude.lib.mjs:1454`) checks this flag and **does not restart**; instead it returns `commandFailed` so the harness reports a real error to the PR.

**Where to implement:**

- New file `src/solve.stuck-watch-detection.lib.mjs` with the classifier
- Wire it into `src/claude.lib.mjs` near line 907 (`if (data.type === 'result')`)
- Track background tasks via the existing `data.type === 'system' && data.subtype === 'task_started'/'task_completed'` events

**Reproduction test:**

Use a recorded JSONL fixture replaying the events from `logs/original.log:49742-55524`. Assert the classifier returns `true` for that fixture and `false` for a normal "no background tasks, multi-paragraph summary" success result.

**Effort:** Medium. ~250 LOC across detector + integration + unit test.

---

## S-2 — Strengthen the prompt to forbid unbounded polling loops 🔴

**Targets:** RC-1

**Change `src/claude.prompts.lib.mjs` near line 131-132.**

Current text:

> When running commands, avoid setting a timeout yourself. Let them run as long as needed.
> When running sudo commands ... use the run_in_background parameter or append & to the command.

Add (proposed wording):

> ### Polling and waiting for external events
>
> - When you need to wait for an external event (CI run, deployment, async job), **do NOT use an unbounded `until ... do sleep N; done` shell loop**, even with `run_in_background: true`. The Claude session may end its turn before the loop completes, and the loop will be silently orphaned with no way to recover the result.
> - Always cap polling: bound by _iterations_ (e.g. `for i in $(seq 1 30); do ... done`), by _total wall-clock_ (e.g. `timeout 600 bash -c '...'`), or by _number of foreground turns_ (poll once per turn and wait for the user/system to advance the conversation).
> - Prefer the foreground `Monitor` / `Read` poll-and-wait pattern over a background shell watcher whenever a single check fits in one turn.
> - When polling CI specifically, the maximum reasonable wait is one CI workflow timeout (typically 30 min). If you must wait, use `timeout 1800 ...` and treat the timeout as failure, not as a reason to retry forever.

**Effort:** Trivial (text change), no test needed.

---

## S-3 — Cost & wall-clock ceilings on auto-restart 🔵

**Targets:** RC-4

**Change `src/claude.lib.mjs` checkForUncommittedChanges + the surrounding restart loop.**

Add three independent ceilings:

| Ceiling                  | Default  | CLI flag                       | Behaviour on hit              |
| ------------------------ | -------- | ------------------------------ | ----------------------------- |
| Cumulative wall-clock    | 1 h 30 m | `--auto-restart-max-wall-time` | Stop restarting; report to PR |
| Cumulative cost (USD)    | $5.00    | `--auto-restart-max-cost`      | Stop restarting; report to PR |
| Restarts with no commits | 1        | `--auto-restart-max-empty`     | Stop restarting; report to PR |

The third is the most surgical: a session that ends with `end_turn` and produced **zero new commits** since the previous session's HEAD is suspicious, and a _second_ such session is almost certainly stuck. This is independent of S-1 and adds a backstop.

**Effort:** Small. ~80 LOC in the restart wrapper + 3 new CLI flags.

---

## S-4 — Verbose tracing of background tasks at result-event time 🟡

**Targets:** RC-5, requirement #11 from issue

**Change `src/claude.lib.mjs:910` (the existing "Result event received" log).**

Replace:

```js
await log(`📌 Result event received, starting ${streamCloseTimeoutMs / 1000}s stream close timeout (Issue #1280)`, { verbose: true });
```

with logic that maintains a `Map<task_id, { startedAt, description }>` populated from `data.type === 'system' && data.subtype === 'task_started'`, removed on `task_completed`, and at result-event time emits:

```
📌 Result event received, starting 30s stream close timeout (Issue #1280)
🔎 Background tasks still alive at result event: 1
   ├─ bebe1a8de  age=42s  desc="Wait for new CI run, report failures only"
```

When 0 background tasks are alive, log a single-line `Background tasks: clean`. This makes Issue #1739-style hangs trivially diagnosable from the very first tail of the log.

**Effort:** Trivial. ~30 LOC, no behaviour change.

---

## S-5 — Upstream fix in `anthropics/claude-code` 🟠

**Targets:** RC-2, RC-3

The harness can paper over the symptoms but cannot fix the underlying CLI behaviour. Two upstream changes are needed:

### S-5a — Tighten the sleep-loop guard

Currently the guard catches `sleep N && cmd` foregrounded but not the `until <check>; do sleep N; done` shape, and the suggested workaround is _itself_ the dangerous pattern. Suggested upstream behaviour:

- Detect `until ... do sleep N; done` and `while ... do sleep N; done` shell shapes; warn-or-block them when N × max-iterations is unbounded.
- Allow them only when wrapped in `timeout T bash -c '...'`.
- Update the guard's remediation message to recommend a bounded loop, not an unbounded one.

### S-5b — Refuse `end_turn` while local-bash background tasks are alive

The most surgical fix: if the model emits a final `text` block (no further `tool_use`) and any registered `task_started` does not yet have a matching `task_completed`, the runtime should either:

1. Inject a synthetic system message (`"You have N background tasks still running: [...]. Either wait for them with BashOutput, cancel them with KillShell, or commit to ending the session anyway."`) and continue the turn; **or**
2. Refuse to emit `result.success`/`stop_reason: end_turn` until the tasks complete or are killed.

Either prevents the orphaned-task / passive-text / end_turn / restart cascade.

A draft issue is in [`external-research.md` §"Upstream issue draft"](./external-research.md).

**Effort to file the issue:** ~30 minutes. Effort upstream: unknown.

---

## S-6 — Reproducible test fixture 🟡

**Targets:** D-2 (implicit requirement)

Add `tests/stuck-watch-detection.test.mjs` with two JSONL fixtures replayed through the classifier:

1. `tests/fixtures/stuck-watch-issue-1739.jsonl` — extracted from line 49 700–55 525 of `logs/original.log`. Asserts `stuck_watch_detected === true`.
2. `tests/fixtures/normal-success-result.jsonl` — synthetic, with a multi-paragraph summary and no surviving background tasks. Asserts `stuck_watch_detected === false`.

**Effort:** Small. ~80 LOC.

---

## Priority and PR scope

For PR #1740 the proposed scope is:

| Fix | In PR #1740?  | Reason                                                                                                |
| --- | ------------- | ----------------------------------------------------------------------------------------------------- |
| S-2 | ✅            | One-line prompt change, immediate uplift, low risk                                                    |
| S-4 | ✅            | Trivial, requested by the issue ("add debug output")                                                  |
| S-1 | ✅ (skeleton) | Detector wired in, behaviour gated behind `--abort-on-stuck-watch` flag (default off until validated) |
| S-3 | ⏳ Follow-up  | Needs new CLI flags, broader review                                                                   |
| S-5 | ⏳ Follow-up  | Upstream — file the issue but don't gate this PR on it                                                |
| S-6 | ✅            | Required to verify S-1                                                                                |

---

## Tests

- `tests/stuck-watch-detection.test.mjs` — classifier returns the right answer on the fixture.
- `tests/background-task-tracking.test.mjs` — the new task-tracking Map is correctly populated and pruned by JSONL events.
- Manual reproduction recipe in `external-research.md`.
