# Case Study: CPU Load Average Display Exceeds CPU Count (Issue #1637)

## Overview

Issue #1637 reported this `/limits` output:

```text
CPU
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓ 100% ⚠️
6.85/6 CPU cores
```

The confusing part is the second data line. A machine with 6 available CPUs
cannot use 6.85 CPU cores at one instant, so the display looked physically
impossible.

## Preserved Data

- `data/issue-1637.json`: issue title, body, labels, and timestamps.
- `data/issue-1637-comments.json`: issue comments; empty at investigation time.
- `data/pr-1638.json`: prepared PR metadata before implementation.
- `data/pr-1638-before.diff`: prepared PR diff before implementation.
- `data/pr-1638-conversation-comments.json`: PR conversation comments; empty.
- `data/pr-1638-review-comments.json`: PR inline comments; empty.
- `data/pr-1638-reviews.json`: PR reviews; empty.
- `data/local-cpu-snapshot.txt`: local Ubuntu kernel, Node, `/proc/loadavg`,
  `nproc`, `uptime`, and selected `/proc/stat` data.
- `logs/limits-display-before.log`: failing regression test before the fix.
- `logs/limits-display-after.log`: passing regression test after the fix.
- `logs/npm-test.log`: full `npm test` verification under Node 24.
- `logs/lint.log`: `npm run lint` verification under Node 24.
- `logs/format-check.log`: `npm run format:check` verification under Node 24.
- `logs/docs-validation.log`: `tests/docs-validation.mjs` verification.
- `logs/validate-changeset.log`: local changeset validation output.
- `logs/line-limits.log`: file line-limit check with `node_modules`
  temporarily moved aside to match the CI job order.
- `logs/nvm-install-node24.log`: Node 24 installation log for local testing.
- `logs/node24-global-install.log`: global package setup needed by `use-m` in
  the local Node 24 prefix.

No CI failure logs existed for this PR at the start of the work session.

## Timeline

1. 2026-01-18: PR #1138 changed `/limits` CPU display from a descriptive
   header into an `X/Y CPU cores` line based on the 5-minute load average.
2. 2026-04-17 22:30 UTC: Issue #1637 reported `6.85/6 CPU cores`.
3. 2026-04-17 22:35 UTC: PR #1638 was created as a draft with only the
   generated `.gitkeep` timestamp change.
4. 2026-04-17 22:40 UTC: Local snapshot confirmed a 6-CPU Linux environment,
   with `nproc`, Node `os.cpus().length`, and Node `os.availableParallelism()`
   all reporting 6.
5. 2026-04-17: A regression test was added for `loadAvg5 = 6.85` and
   `cpuCount = 6`; it failed against the existing formatter.
6. 2026-04-17: The formatter was changed to cap the displayed CPU cores at the
   available CPU count while retaining the raw 5-minute load average as
   diagnostic context when demand exceeds capacity.

## Requirements From The Issue

1. Explain how `/limits` can show more loaded CPU cores than available CPUs.
2. Find the root cause, not just the symptom.
3. Show CPU load in a way that does not exceed the number of CPUs.
4. Investigate whether Ubuntu has a more precise source for CPU information.
5. Preserve related issue and PR data in `docs/case-studies/issue-1637`.
6. Search external references for how CPU load average works.
7. Add debug or verbose output only if current data is insufficient.
8. File upstream issues only if this is caused by another project.

## Root Cause

The bug is a unit/labeling mistake in `formatUsageMessage()`.

`getCpuLoadInfo()` reads the 1-minute, 5-minute, and 15-minute load averages
from `/proc/loadavg` or `uptime`. It then calculates the percentage as:

```javascript
Math.min(100, Math.round((loadAvg5 / cpuCount) * 100));
```

That percentage was already capped at 100. The formatter then printed the raw
5-minute load average as if it were "CPU cores used":

```javascript
`${parseFloat(cpuLoad.loadAvg5.toFixed(2))}/${cpuLoad.cpuCount} CPU cores`;
```

For `loadAvg5 = 6.85` and `cpuCount = 6`, this produced `6.85/6 CPU cores`
even though the progress bar was capped at `100%`.

## Why 6.85/6 Is Possible

Linux load average is not the same thing as bounded CPU utilization. The
`/proc/loadavg` manual defines the first three fields as jobs in the run queue
or waiting for disk I/O, averaged over 1, 5, and 15 minutes:
https://man7.org/linux/man-pages/man5/proc_loadavg.5.html

The `uptime` manual adds that load averages are not normalized by CPU count:
https://man7.org/linux/man-pages/man1/uptime.1.html

Node exposes the same OS concept through `os.loadavg()`, which returns the
1-minute, 5-minute, and 15-minute load averages:
https://nodejs.org/api/os.html#osloadavg

So `6.85` on a 6-CPU host means average demand exceeded available CPU capacity
over the 5-minute window. It can include runnable tasks waiting for CPU and, on
Linux, tasks in uninterruptible I/O wait. It is valid load-average data, but it
was misleading to print it as used CPU cores.

## Fix

The formatter now separates capacity-bounded "cores used" display from raw load
average demand:

```text
CPU
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓ 100% ⚠️
6/6 CPU cores used (5m load avg 6.85)
```

For non-saturated cases, the output stays compact:

```text
2.8/4 CPU cores used
```

`getCpuLoadInfo()` also now returns `usedCpuCores`, capped to `cpuCount`, so
callers can use an explicit field instead of interpreting `loadAvg5` directly.

## Alternatives Considered

### Keep raw load average only

Display could have changed to `5m load average: 6.85 on 6 CPUs`. That would be
technically correct, but it would remove the familiar `X/Y` resource style used
by RAM and disk.

### Switch `/limits` to sampled CPU utilization

Ubuntu can measure actual CPU utilization from `/proc/stat` by sampling CPU
time counters over an interval and computing non-idle deltas. The
`/proc/stat` manual documents the CPU time fields:
https://man7.org/linux/man-pages/man5/proc_stat.5.html

This is more precise for "CPU time used right now", but it is a different
signal from load average. The solve queue intentionally uses 5-minute load
average because it is more stable for gating new work. Switching the metric
would be a larger behavior change and could make queue decisions more sensitive
to short spikes or brief idle moments.

### File an upstream issue

No upstream issue is needed. Linux and Node are reporting the documented
load-average concept correctly. The defect was in this project's presentation
of that value.

## Verification

- Added regression coverage in `tests/limits-display.test.mjs`.
- Confirmed the test fails before the formatter change:
  `logs/limits-display-before.log`.
- Confirmed the test passes after the formatter change:
  `logs/limits-display-after.log`.
