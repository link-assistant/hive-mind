# Root Cause Analysis — Issue #1739

The session did not crash. It got _stuck_ in a state that no single component recognises as pathological. Five distinct factors compound. Removing any one of them would have prevented the 2 h 54 min hang.

---

## RC-1 — Unbounded `until ... do sleep N; done` polling loop emitted by the model

### Evidence

`logs/original.log:49755`:

```bash
until [ "$(gh run view 25213264339 --repo link-foundation/meta-sovereign --json status -q .status)" = "completed" ]; do sleep 20; done; gh run view 25213264339 ... 2>&1
```

The model wrote this as a _single shell command_ with no timeout, no max-iteration count, and no fallback. If the CI run never reaches `completed` (network failure, GitHub outage, run silently cancelled, the `gh run view` rate-limited and returning empty stdout, etc.), this loop waits forever.

### Why the model did it

- The harness's prompt (`src/claude.prompts.lib.mjs:131-132`) says: _"avoid setting a timeout yourself. Let them run as long as needed."_ and _"Use the run_in_background parameter."_
- Upstream Claude Code's own _anti-sleep guard error message_ (line 68615) explicitly suggests `until <check>; do sleep 2; done` as the canonical wait pattern.
- The model has no instruction to put an upper bound on polling — neither in turns, in iterations, nor in seconds.

### Severity

🔴 **Critical** — single point of failure, easy to fix in the prompt.

---

## RC-2 — `run_in_background: true` bypasses the upstream sleep-loop guard

### Evidence

- Phase A (line 49757): `"run_in_background": true` succeeds, no guard fires, watcher starts.
- Phase B (line 68615): same logical pattern run _foregrounded_ gets blocked: _"Blocked: sleep 30 followed by: gh run list ..."_

The guard's wording even tells the model how to bypass it: _"To wait for a command you started, use run_in_background: true"_. The two halves of upstream's guidance contradict each other when the polling shape is the very thing being waited for.

### Why this is a problem

The guard exists precisely because indefinite polling kills sessions. Allowing `run_in_background: true` to bypass it means the most pernicious shape (a watch loop that survives the assistant turn) is the _only_ shape that gets through.

### Severity

🟠 **High** — needs to be reported upstream (`anthropics/claude-code`); cannot be fully fixed inside hive-mind.

---

## RC-3 — `result.end_turn` does not reflect "work is done"

### Evidence

`logs/original.log:55460-55516`:

```json
"subtype": "success",
"is_error": false,
"num_turns": 242,
"result": "Wait for the watch command to finish — I'll be notified when the background bash task completes.",
"stop_reason": "end_turn",
"terminal_reason": "completed"
```

- `subtype: success` and `terminal_reason: completed` are both fields the harness uses to decide whether the session "completed cleanly".
- The actual result string is one passive sentence with no work artefacts, no commits, no merge-readiness signal.
- A background task `bebe1a8de` is still listed in the runtime as `task_started`; no `task_completed` event exists in the entire log past line 49 795.

### Why the harness can't tell

`src/claude.lib.mjs:907-922` only checks `data.subtype === 'success'` to decide we got a clean end. There is no `still_running_background_tasks` field, no "did the model do real work this turn?" check, and no "result string is too short / too passive" heuristic.

### Severity

🔴 **Critical** — this is the single signal that wrongly flips the harness from "still working" to "done, decide what to do next".

---

## RC-4 — Auto-restart on uncommitted changes amplifies the bug

### Evidence

`logs/original.log:55586-55598`:

```
🔍 Checking for uncommitted changes...
?? deno.lock
🔄 AUTO-RESTART: Restarting Claude to handle uncommitted changes...
```

Cited code: `src/claude.lib.mjs:1454-1459`.

### Why this matters

- `deno.lock` is a generated file the model should not have created in the first place — but its presence is _unrelated_ to the watch-loop bug.
- The auto-restart has no awareness of the previous session's "did real work?" state. It restarts unconditionally as long as `git status` is non-empty.
- Each restart re-loads the prompt, re-loads the issue, re-asks Claude to monitor CI — and the same `until ... sleep` antipattern re-emerges. With `--auto-restart-until-mergeable` (default 5 iterations), one stuck-watch can cost up to 5 × $13 ≈ **$65** before any human notices.

### Severity

🟠 **High** — cost amplifier; needs a "session was stuck" classifier before restart.

---

## RC-5 — No tracing of live background tasks at session-end

### Evidence

- The log records `"type": "system", "subtype": "task_started"` events but never the corresponding `task_completed` for `bebe1a8de`.
- The harness logs `📌 Result event received` and `📊 Session num_turns: 242` but **does not enumerate which background tasks Claude registered and which never finished**. A simple `Background tasks alive at result event: [bebe1a8de]` line would have made root cause obvious from the first tail of the log.

### Severity

🟡 **Medium** — improves diagnosability; required to satisfy issue requirement #11.

---

## How the five factors compound

```
[RC-1]  model writes unbounded poller
   │
   ▼  + [RC-2]  run_in_background: true bypasses guard
   │
   ▼  Background task `bebe1a8de` registered, never completes
   │
   ▼  Model has nothing else to say → emits one sentence → end_turn
   │
   ▼  + [RC-3]  harness reads result.success = "done", begins shutdown
   │
   ▼  + [RC-5]  no log line names the orphaned task
   │
   ▼  + [RC-4]  uncommitted deno.lock triggers auto-restart
   │
   ▼  New session repeats RC-1 / RC-2 → infinite loop
   │
   ▼  User CTRL+C after 2 h 54 min, $12.87 burned
```

Removing any _one_ of RC-1, RC-2, RC-3, or RC-4 breaks the loop. Adding RC-5's logging makes the next occurrence trivial to diagnose without running another forensic case study.
