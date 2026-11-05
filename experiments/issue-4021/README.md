# Queue work accounting regression

The production report supplies the two idle Codex command lines. There are no attached logs or screenshots. The exact pre-fix `getRunningProcesses` implementation comes from main commit `b92e0596b`; the offline reproduction feeds that function synthetic `pgrep` output and uses the actual queue throttling module with cached 98% weekly usage.

```sh
node experiments/issue-4021/reproduce.mjs
node tests/queue-work-accounting-4021.test.mjs
```

Expected reproduction:

```text
Before: 2 idle services counted; 98% weekly usage blocks dispatch.
After: 0 active jobs; 98% weekly usage admits one task.
```

The permanent regression suite covers foreground classification for all five supported tools, service/helper exclusion, wrapper/native trees, process disappearance and zombies, active app-server-backed executions, Docker PID namespaces, detached screen identities, stale tracked records, resource throttling, and consistent compact/detailed counts. Real work blocks at 98% and remains parallel at 50%. Direct starts and the consumer share an admission reservation; one-at-a-time remains atomic with a zero startup interval, and the caller releases a reservation after a successful or failed launch.

Classification uses NUL-separated argv from Linux procfs and the same process/session identity fields already used by repository diagnostics. It never searches arbitrary prompt text for a vendor name, kills services, calls a provider, or logs command lines/environment values. Verbose work-count diagnostics are off by default.

Live tracked execution status remains authoritative for app-server work: an idle daemon alone counts zero, while each running tracked execution counts once. Untracked sibling-container discovery/adoption remains the separately reported scope of related #2917; this fix retains the existing tracked Docker liveness reconciliation and prevents its counts from being hidden by local-process counts.
