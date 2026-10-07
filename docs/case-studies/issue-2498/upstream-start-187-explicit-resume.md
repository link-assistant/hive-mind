Explicit `$ --resume` in start-command **0.35.3** needs attempt-scoped terminal evidence and lifecycle metadata. This surfaced while investigating [hive-mind#2498](https://github.com/link-assistant/hive-mind/issues/2498) and [PR #2499](https://github.com/link-assistant/hive-mind/pull/2499): a live resumed task can share a log whose latest exit footer still belongs to its previous killed attempt.

A finite reproduction calls the actual exported `resumeExecution()` with a stored detached Docker execution, a stopped-container probe, a successful mocked `docker start`, and a no-op watcher. No containers, OOM pressure or unbounded inputs are needed. The original record has exit 137, `memoryExhausted=true`, `memoryExhaustedReason=cgroup-oom-killer` and `cgroupMemory.oomKills=1`; its log has a standard finished/exit-137 footer.

Observed after successful resume:

- The saved record becomes `status=executing`, `exitCode=null`, `endTime=null`, and clears `exitReason` and `oomKilled`.
- **It retains `memoryExhausted`, `memoryExhaustedReason` and `cgroupMemory` from the stopped attempt.**
- `options.resumedAt` and `resumeCount` change, but the same UUID/log remain and there is **no explicit-resume attempt boundary in the log** (a resource-limit line is appended only when limits exist). Until new output/completion, the latest footer remains the previous exit 137.

`src/lib/execution-resume.js:applyResumeToRecord()` clears only part of the terminal evidence. `resumeExecution()` starts the completion watcher with the existing log before saving the resumed record. Native automatic recovery already clears `cgroupMemory` in `execution-recovery.js`, so the explicit path differs.

Please preserve previous evidence in attempt history, clear or baseline all attempt-local memory fields, and expose the current attempt's start time and log byte boundary in status/list. Append a structured lifecycle boundary for explicit resume, including attempt number, previous/new container names, accepted launch, watcher attachment and later terminal result. Launch acceptance should remain distinct from observed command output or successful completion. A last-output timestamp would also let supervisors report a quiet pending run without claiming task progress.

Hive Mind is adding its own pre-launch byte boundary, fresh attempt time, cache reset, lifecycle reporting and bounded activity reads. This protects new resumes but cannot supply upstream metadata for another client or reconstruct every older resumed record.

Reproduction script and captured JSON will be committed at:

- [experiments/issue-2498-start-resume-state.mjs](https://github.com/link-assistant/hive-mind/blob/issue-2498-69233edb3b6c/experiments/issue-2498-start-resume-state.mjs)
- [start-0.35.3-resume-state.json](https://github.com/link-assistant/hive-mind/blob/issue-2498-69233edb3b6c/docs/case-studies/issue-2498/start-0.35.3-resume-state.json)

Run with an unpacked npm package with dependencies installed:

```sh
node --max-old-space-size=128 experiments/issue-2498-start-resume-state.mjs /absolute/path/to/start-command/package
```

Related: #180 and #182 fixed initial OOM attribution/collection; this report concerns resetting and scoping that evidence on explicit resume. #185/#186 fixed count interpretation and are consumed in 0.35.3.
