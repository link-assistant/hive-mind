# External Research — Issue #1739

This file collects relevant prior art, reusable libraries, upstream issues, and a draft for the upstream report. It supports requirements #9 and #10 of the issue.

---

## Related hive-mind case studies (internal prior art)

| Case study                                                                             | Pattern                                                                | Relevance                                                                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`issue-882-tool-agent-infinite-loop`](../issue-882-tool-agent-infinite-loop/)         | Agent ↔ Claude CLI fallback with bad model name; rapid retry loop      | Same shape: a retry loop without a sane termination predicate. The fix landed there (cap retries) is a precedent for S-3 here.    |
| [`issue-895-agent-infinite-restart-loop`](../issue-895-agent-infinite-restart-loop/)   | PR description edit detection ↔ agent edit creates a self-feeding loop | Same root mechanism: the _harness_ misclassifies "stuck" state as "needs restart". S-1's classifier is in the same family of fix. |
| [`issue-861-flaky-timeout-test`](../issue-861-flaky-timeout-test/)                     | Timeouts surfacing too late                                            | Argues for shorter, more decisive timeouts                                                                                        |
| [`issue-642-codex-watch-mode-and-network`](../issue-642-codex-watch-mode-and-network/) | Watch mode hang, codex                                                 | Closest analogue — a watch loop that survives the parent                                                                          |
| [`issue-1280`](../issue-1280/)                                                         | Stream close timeout / SIGTERM force-kill                              | The exit handler we observed in this log (`exit code 143`); not the bug, but the safety net that _should_ have fired earlier      |
| [`issue-1510`, `issue-1516`](../)                                                      | Same family of stream timeout                                          | Referenced in `claude.lib.mjs:910` log line                                                                                       |

The three taken together suggest a pattern: **the harness has many "noticed-too-late" detectors, and would benefit from one consolidated "session is no longer making progress" classifier** (which is exactly S-1).

---

## Upstream issues to check / file

### Existing upstream issues that may already track this

Searches to run before filing a duplicate:

```bash
gh search issues --repo anthropics/claude-code "background task end_turn" --json number,title,state
gh search issues --repo anthropics/claude-code "until sleep run_in_background" --json number,title,state
gh search issues --repo anthropics/claude-code "watch loop stuck" --json number,title,state
gh search issues --repo anthropics/claude-code "orphan background task" --json number,title,state
```

Known referenced upstream:

- `anthropics/claude-code#6805` — JSONL deduplication. Cited in this log at line 55 530. Not the same bug but adjacent (parser-side robustness).
- (To be filed) — see "Upstream issue draft" below.

### Upstream issue draft

````markdown
**Title**: `end_turn` accepted while `run_in_background: true` Bash tasks remain registered, leading to orphaned shells and silent session death

**Body**:

### Summary

The Claude Code CLI accepts a `result` event with `stop_reason: end_turn` and `terminal_reason: completed` even when one or more `Bash` tool calls launched with `run_in_background: true` have a `task_started` event but no corresponding `task_completed`. The OS-level shell processes survive the assistant turn and the CLI exits, leaving the harness driver no way to recover their output and no signal that the "completed" session is actually stuck.

This interacts badly with shell guards: the foreground Bash guard correctly blocks `sleep N && cmd`, but its remediation message recommends `until <check>; do sleep N; done` and `run_in_background: true` — exactly the pair that produces orphaned watchers.

### Reproduction

Minimum reproducible example (works against any harness driving the JSONL stream):

1. Send the model a system prompt that includes:
   > Wait for the GitHub Actions run to finish before responding.
2. Provide a runID that does not exist (or a CI run that is intentionally stuck).
3. The model emits:
   ```json
   {
     "type": "tool_use",
     "name": "Bash",
     "input": {
       "command": "until [ \"$(gh run view RUNID --json status -q .status)\" = \"completed\" ]; do sleep 20; done",
       "run_in_background": true
     }
   }
   ```
````

4. The CLI accepts and responds:
   ```json
   { "type": "system", "subtype": "task_started", "task_id": "abcd1234" }
   ```
5. The model emits one assistant `text` block ("I'll wait for the watch command...") and the runtime emits:
   ```json
   { "type": "result", "subtype": "success", "stop_reason": "end_turn", "terminal_reason": "completed" }
   ```
6. The CLI's stream closes; the harness driver sees a "successful" result.
7. The `abcd1234` shell continues running in the OS until the parent process tree is killed.

### Forensic example

A real instance of this bug occurred on 2026-05-01, captured in https://gist.github.com/konard/d8c2366ab072ada256e39c4021a13149 (lines 49742–55524). Background task `bebe1a8de` had `task_started` with no matching `task_completed`; the assistant emitted `"Wait for the watch command to finish"` and `end_turn`. The session burned $12.87 across 242 turns and was eventually killed by CTRL+C after 2 h 54 min of wall-clock.

### Workarounds for harness authors

Pending an upstream fix:

1. Track `system.task_started` and `system.task_completed` in the JSONL stream and treat a `result.success` with N > 0 surviving background tasks as a failure.
2. After observing the antipattern once, prepend a system message before the next turn that explicitly forbids `until ... do sleep N; done` patterns even with `run_in_background: true`.

### Suggested fix (any one would help)

1. **Block `end_turn` while local-bash tasks are alive.** Inject a synthetic system message: _"You have N background tasks still running. Either wait for them with `BashOutput`, kill them with `KillShell`, or explicitly request session end."_
2. **Strengthen the existing sleep-loop guard.** Detect `until <check>; do sleep N; done` and `while <check>; do sleep N; done`; require they be wrapped in `timeout T bash -c '...'`. Update the guard's remediation message accordingly.
3. **Add a `terminal_reason: orphaned_tasks`** subtype so harnesses can distinguish _"clean end-of-turn"_ from _"end-of-turn with surviving children"_.

### Severity

Medium-high — it does not crash the CLI, but it makes long automated sessions unreliable for any task that involves waiting on external state (CI, deployments, async jobs).

````

(File the issue with `gh issue create --repo anthropics/claude-code --title "…" --body "$(cat …)"` after PR #1740 review, per requirement #12.)

---

## Reusable components / libraries that solve similar problems

The general problem is *bounded polling with cancellation*. None of the patterns Claude reaches for naturally are best-in-class. Better off-the-shelf options:

| Component                   | Language     | What it gives us                                                                                |
| --------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `gh run watch <id>`         | gh CLI       | Built-in finite-timeout watcher with `--exit-status`. Already present on every box that has `gh`. The model should be told to use this instead of hand-rolled `until` loops. |
| `timeout` (coreutils)       | shell        | `timeout 1800 gh run watch <id>` immediately bounds the wait. Available everywhere.             |
| `cb` / `wait-for-it`        | shell        | Declarative `wait-for` URLs/ports with deadlines.                                               |
| `p-retry`, `p-timeout`      | Node.js      | If the harness ever reimplements polling internally.                                            |
| `node:timers/promises` `setTimeout` | Node.js | Cancel-via-AbortSignal from harness side.                                                        |
| `chokidar` / `fs.watch`     | Node.js      | For *file-system* watches we can use event-based instead of polling                              |
| `eventsource` / SSE         | -            | Some GitHub APIs offer SSE — better than polling                                                 |

For S-2 (prompt change) the high-value advice is: *prefer `gh run watch <run-id> --exit-status` (a finite-timeout watcher) over hand-rolled `until` loops*.

---

## Reproduction recipe (for D-1)

A self-contained reproduction can be built without paying for a full Anthropic call by replaying a captured JSONL stream into the harness. Steps:

1. Extract lines 49 742 – 55 524 of `logs/original.log` to `tests/fixtures/stuck-watch-issue-1739.jsonl`.
2. Stand up a local fixture-replay test that pipes the JSONL into the same parser used by `src/claude.lib.mjs`.
3. Assert (a) the `result` event is observed, (b) the harness's "still busy" detector returns `true` (after S-1 lands).

For an end-to-end repro:

1. `gh repo create scratch/test-1739 --public --add-readme`
2. Add a workflow that just sleeps 1 hour: `.github/workflows/sleep.yml` with `run: sleep 3600`.
3. Push, then run:
   ```bash
   solve https://github.com/scratch/test-1739/pull/1 --tool claude --model opus --verbose
````

4. Observe the same `until ... sleep` background watcher in the JSONL stream.

(Don't actually run that against the real Anthropic API in CI — it costs money. Use the fixture replay.)

---

## What the web says about this class of bug

(Search performed via in-repo notes; verifying live searches is recommended before filing the upstream issue.)

- The "agent emits unbounded `until` poller" pattern shows up across LangChain, AutoGPT and tool-calling agents. The recurring fix is to teach agents the `gh run watch` / `kubectl wait --timeout` style — finite-timeout watchers — instead of letting them hand-roll a poll loop.
- "End-of-turn with detached child" is a well-known interaction-loop antipattern in autonomous agents: the parent runtime marks the agent task complete, but the child shell process continues. The standard fix in tools like Cursor and Aider is to _kill all spawned background processes when the agent yields_, which is the conservative version of S-5b.
- Claude Code's own best-practice guidance (in the Bash tool description visible in the system prompt at the top of this very session) recommends `Monitor` for "wait until done" and `run_in_background` for "long-running command you'll come back to". Neither was used correctly here — the model used `run_in_background` for what should have been a `Monitor` job, then ended its turn, which is the documented antipattern.

---

## Open questions for follow-up

1. Does the harness already have a way to enumerate live PIDs of `claude`-spawned shells at session-end? (If yes, S-4 is a 5-minute change.)
2. Is `gh run watch` available on all CI runners we drive Claude on? (Almost certainly yes — `gh` is part of the base image.)
3. Should `--auto-restart-until-mergeable` default to a _cumulative cost ceiling_ rather than a fixed iteration count? (S-3 argues yes.)
