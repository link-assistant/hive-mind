# Case study: issue #2498 — "Looks like we have false positive for OOM killing"

- Issue: https://github.com/link-assistant/hive-mind/issues/2498
- Affected run: https://github.com/link-foundation/package-registry-manager/pull/27
  - [comment 5983682088](https://github.com/link-foundation/package-registry-manager/pull/27#issuecomment-5983682088): solve's own "🚨 Solution Draft Failed" comment ([copy](./comment-5983682088.md))
  - [comment 5983686167](https://github.com/link-foundation/package-registry-manager/pull/27#issuecomment-5983686167): intermediate working-session log ([copy](./comment-5983686167.md))
  - [comment 5983686346](https://github.com/link-foundation/package-registry-manager/pull/27#issuecomment-5983686346): the misleading "⚠️ Container OOM event during a failed work session" notice ([copy](./comment-5983686346.md))
- Upstream reports filed from this case:
  - [link-foundation/start#180](https://github.com/link-foundation/start/issues/180): `memoryExhausted` derived from the sticky flag;
  - [link-foundation/start#181](https://github.com/link-foundation/start/issues/181): random delay for `--on-kill-resume` ([copy](./upstream-start-181-recovery-delay.md));
  - [link-foundation/start#182](https://github.com/link-foundation/start/issues/182): per-container cgroup OOM counters in `--status` ([copy](./upstream-start-182-cgroup-oom-counters.md));
  - [link-foundation/start#185](https://github.com/link-foundation/start/issues/185): report raw OOM counts without inferring kill scope from their ratio ([copy](./upstream-start-oom-scope.md));
  - [link-foundation/start#187](https://github.com/link-foundation/start/issues/187): reset explicit-resume memory evidence and record attempt boundaries/lifecycle ([copy](./upstream-start-187-explicit-resume.md)).
- Owner feedback on PR #2499: [comment](https://github.com/link-assistant/hive-mind/pull/2499) ([copy](./pr-2499-feedback.md)), pointing at [link-foundation/meta-language#196 comment 5985077141](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5985077141) ([copy](./meta-language-196-comment-5985077141.md))

## Data in this folder

| File                                                                       | What it is                                                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `failure-log.txt`                                                          | Full `solve` log, uploaded by solve itself (timestamped lines, 58 926 lines)                                                            |
| `intermediate-log.txt`                                                     | The start-command log of the container, uploaded by the bot with the kill notice (comment 5983686167)                                   |
| `gist-log.txt`                                                             | The gist linked from the issue                                                                                                          |
| `comment-*.md`                                                             | Bodies of the three pull-request comments                                                                                               |
| `meta-language-196-*.md`                                                   | The parallel session on link-foundation/meta-language#196: its failure comment, log comment, kill notice and the audit the owner linked |
| `meta-language-196-log-excerpt.txt`                                        | The lines of that session's 56 MB log that show the OOM kills and the authentication stop, with links to the full logs                  |
| `pr-2499-feedback.md`                                                      | The owner's review comment on PR #2499                                                                                                  |
| `*.txt.gz`                                                                 | Full meta-language incident logs, PR #2499 feedback gists and validation logs, compressed losslessly                                    |
| `dependency-freshness-*.txt`                                               | Before/after comprehensive dependency audit                                                                                             |
| `*-reproduction-before.txt`, `targeted-after.txt`, `upstream-contract.txt` | Reproducing failures, regression results and actual upstream package probe                                                              |
| `upstream-start-*.md`                                                      | Bodies of the upstream reports #181, #182, #185 and #187                                                                                |

**Is the gist different from the logs in the comments?** No, apart from sanitisation. `gist-log.txt` and `intermediate-log.txt` are the same start-command log. If every 40-character hex SHA is replaced with a placeholder, the two files are identical: the only differences are commit SHAs, which the gist has in full and the bot's sanitised upload shortened to `abc…def` in some places (59 075 lines each). Both end with the same container post-mortem:

```
Exit Code:  1
OOMKilled:  true
StartedAt:  2026-10-04T18:59:06.159003017Z
FinishedAt: 2026-10-04T19:41:06.490191654Z
Reason: exitCode=1 oomKilled=true
```

`failure-log.txt` is solve's own log of the same run, with timestamps on every line. The timeline below is built from it.

The [`raw`](./raw) directory preserves the issue, PR description/comments before this review and the upstream release metadata; [`upstream-pr-184.diff`](./upstream-pr-184.diff) records the upstream implementation audited here. Compressed archives have a [SHA-256 manifest](./archive-sha256.txt) and can be read with `gzip -dc <file>`.

The [recovery visibility feedback](./pr-2499-feedback-recovery-visibility.md), [second solution-draft log](./pr-2499-second-solution-draft-log.txt.gz), [latest dependency audit](./dependency-audit-2026-10-05-follow-up.txt), and [actual start-command 0.35.3 resume probe](./start-0.35.3-resume-state.json) preserve the evidence for the final follow-up below.

## Timeline (UTC, 2026-10-04)

| Time              | Event                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Source                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 18:59:06          | Container `bebf2e57-…` starts (`--isolation docker`, `--on-session-kill resume`)                                                                                                                                                                                                                                                                                                                                                                                    | gist footer           |
| 18:59:22          | `solve v2.33.11` starts; 6.6 GB available of 11.7 GB                                                                                                                                                                                                                                                                                                                                                                                                                | failure-log.txt:16    |
| 19:05–19:32       | Claude works on the PR; the context is compacted 5 times                                                                                                                                                                                                                                                                                                                                                                                                            | failure-log.txt       |
| 19:30:37          | Background task `bvry8e4xa` (a `python3` edit followed by a cargo build) runs                                                                                                                                                                                                                                                                                                                                                                                       | failure-log.txt:50385 |
| 19:32:29          | `cargo clippy --all-targets --all-features` starts in the foreground while the background build is still running                                                                                                                                                                                                                                                                                                                                                    | failure-log.txt:53492 |
| 19:32:44          | `bvry8e4xa` completes                                                                                                                                                                                                                                                                                                                                                                                                                                               | failure-log.txt:53558 |
| **19:32:49**      | **Bot monitor sees `oomKilled=true` in `$ --status`** while the session is alive. It records `oomEventObservedAt` (issue #2134 logic), and the session keeps running                                                                                                                                                                                                                                                                                                | comment 5983686346    |
| 19:36:53          | `cargo test --all-targets` starts                                                                                                                                                                                                                                                                                                                                                                                                                                   | failure-log.txt:54807 |
| 19:38:41          | `rustc --crate-name chromiumoxide_cdp …` is killed: `(signal: 9, SIGKILL: kill)`                                                                                                                                                                                                                                                                                                                                                                                    | failure-log.txt:55135 |
| 19:38:44          | Claude: "The compile hit SIGKILL, which looks like out-of-memory. I'll retry with fewer jobs…"                                                                                                                                                                                                                                                                                                                                                                      | failure-log.txt:55361 |
| **19:40:42**      | **Claude CLI result: `Failed to authenticate: OAuth session expired and could not be refreshed`** (`terminal_reason: api_error`)                                                                                                                                                                                                                                                                                                                                    | failure-log.txt:58663 |
| 19:40:44–19:41:03 | solve classifies the error as `SUBSCRIPTION/ACCESS UNAVAILABLE … [authentication_failed]`, pushes a recovery branch, uploads the failure log and posts comment 5983682088. The PR is marked ready for review                                                                                                                                                                                                                                                        | failure-log.txt tail  |
| 19:41:03          | solve exits **1**, printing `❌ ⚠️ SUBSCRIPTION/ACCESS UNAVAILABLE — CLAUDE stopped: Authentication expired — re-login required [authentication_failed] …`                                                                                                                                                                                                                                                                                                          | gist-log.txt:59053    |
| 19:41:06          | Container exits with code 1. `State.OOMKilled` is still `true`                                                                                                                                                                                                                                                                                                                                                                                                      | gist footer           |
| after 19:41       | Bot monitor completes the session. Telegram shows "❌ Work session failed (exit code: 1)" plus "The work did not fail because of it: solve stopped on its own", but the diagnostics underneath say **Cause: container OOM event**. The PR gets comment 5983686346, titled **"⚠️ Container OOM event during a failed work session"**, which lists ``$ --status` reports memory exhaustion (`cgroup-oom-killer`)`` as evidence and never says why the session stopped | comment 5983686346    |

## What was real and what was false

- **Real:** there were OOM events. The monitor observed the container OOM flag at 19:32:49; a `rustc` process later received SIGKILL at 19:38:41, consistent with another OOM kill but not individually attributable from the old counters. Parallel `cargo` builds are a plausible source of container memory pressure. The configured default is 25% of host RAM (about 2.9 GB here), but the incident logs did not capture this container’s actual limit or attributable kernel OOM records.
- **False:** the OOM events did not end the session. The work process (`solve`, then `claude`) outlived both of them and kept working. Eight minutes after the first one, it stopped because the **Claude OAuth session expired and could not be refreshed**. That is an account/authentication stop, which is the `subscription-blocked` deliberate stop of issue #2408.

So a real OOM event that the main process survived was presented as the reason for the failure, and the actual reason was hidden. That is the "false positive" the issue reports.

## Requirements (from the issue)

1. Find out why the session was reported as an OOM failure ("false positive for OOM killing").
2. Check whether the gist differs from the logs in the comments (answered above).
3. Collect all logs and data in `docs/case-studies/issue-2498` (done: this folder).
4. Do a deep case-study analysis: timeline, requirements, root causes, solutions, existing components, plus an online search for more facts (this document).
5. If the data is not enough to find the root cause, add debug/verbose output (see "Debug output" below).
6. Report issues in other affected repositories, with a reproducible example, workaround and fix suggestion ([link-foundation/start#180](https://github.com/link-foundation/start/issues/180)).
7. Apply the fix everywhere in the codebase where it is relevant, in this single PR.

## Root causes

### RC1 — The PR notice ignored the deliberate stop that had already been detected (hive-mind)

`buildKillCompletionSections()` in `src/session-monitor.kill-sections.lib.mjs` already called `detectDeliberateSolveStop()` (issue #2408). It found the `subscription-blocked` marker in the log tail, and that is why Telegram said "solve stopped on its own". But `announceKillOnPullRequest()` → `buildKillRecoveryNotice()` was never given `deliberateStop`. The PR notice was therefore built only from `oomEventOnly: true`:

- the title was "⚠️ Container OOM event during a failed work session";
- the summary said "container OOM event — a process in the task cgroup was killed earlier …";
- the closing line said "The work process survived the container OOM event but later exited with a failure", with no word about the authentication failure.

The two channels disagreed, and the one that people reading the PR see was the wrong one.

### RC2 — The diagnostics kept calling the OOM event the "Cause" (hive-mind)

Even in Telegram, where the deliberate stop was shown, the diagnostics section that followed came from `formatKillDiagnosticsSection()` with the label **Cause: container OOM event**. Once a deliberate stop is known, the OOM event is context, not the cause.

### RC3 — `$ --status` restates the sticky Docker flag as "memory exhaustion" for any exit code (upstream: start-command)

start-command 0.35.1's `resolveExitReason()` returns `memory-exhaustion (cgroup-oom-killer)` whenever `oomKilled` is true. `resolveMemoryExhaustion()` returns `{memoryExhausted: true, memoryExhaustedReason: 'Docker reported State.OOMKilled=true'}` for any non-zero exit with `oomKilled`. Reproduction: `experiments/issue-2498-start-command-exit-reason.cjs`.

```
exit=0 oomKilled=true -> exitReason="memory-exhaustion (cgroup-oom-killer)" memory=null
exit=1 oomKilled=true -> exitReason="memory-exhaustion (cgroup-oom-killer)" memory={"memoryExhausted":true,"memoryExhaustedReason":"Docker reported State.OOMKilled=true"}
exit=137 oomKilled=true -> exitReason="memory-exhaustion (cgroup-oom-killer)" memory={...}
```

Since moby/moby#43564, Docker's `State.OOMKilled` is set "immediately upon **any** container process getting OOM-killed by the kernel, and cleared to false when the container is restarted". It is a container-wide, sticky observation, not a statement about the main process. The same mistake was fixed for `--on-kill-resume` in link-foundation/start#178, but not in these two functions.

hive-mind passed these fields through (issue #2189, start-command 0.33 `exitReason`/`memoryExhausted`). The notice therefore listed the same sticky flag a second time as if it were independent evidence: ``$ --status` reports memory exhaustion (`cgroup-oom-killer`): `Docker reported State.OOMKilled=true``. That made the OOM verdict look stronger than it was.

### Not a root cause: the session-status classification

`resolveOomKilledState()` (`src/session-monitor.oom.lib.mjs`, #2134/#2408) handled this case correctly. Exit 1 with `oomKilled=true` was classified as `failed` (survived the OOM event), not as `oom-killed`. No recovery session was launched, because the deliberate stop blocked it (#2408). The problem was only in what the reports said.

## Solutions implemented (this PR)

| Root cause       | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Where                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC1              | `announceKillOnPullRequest()` takes `deliberateStop` and passes it to `buildKillRecoveryNotice()`. With a deliberate stop and an earlier OOM event, the notice is titled "ℹ️ Work session stopped on its own — the earlier container OOM event did not cause it". It opens with **Why the work session stopped**, quoting the stop line from the log, then reports the OOM event as "Earlier event (not the cause of this stop)", with "OOM event observed at" and "OOM event diagnostics". A deliberate stop followed by a real kill gets "⚠️ Working session was killed after solve had already stopped on its own". | `src/session-kill-recovery.lib.mjs`, `src/session-monitor.kill-sections.lib.mjs`, `src/session-monitor.lib.mjs`                                      |
| RC2              | `formatKillDiagnosticsSection(diagnosis, { notTheCause: true })` uses the title "Container OOM event diagnostics (not the cause of this stop)" and the label "Event" instead of "Cause". The strings are localised in en/ru/hi/zh.                                                                                                                                                                                                                                                                                                                                                                                     | `src/session-kill-diagnostics.lib.mjs`, `src/locales/*.lino`                                                                                         |
| RC3 (workaround) | `describeKillCause()` recognises the flag-derived upstream report (`memoryExhaustedReason === 'Docker reported State.OOMKilled=true'`, or mechanism `cgroup-oom-killer` without a reason). It folds that report into `oomKilled` instead of treating it as separate memory-exhaustion evidence. Real upstream detections, such as log markers like `JavaScript heap out of memory`, are still passed through.                                                                                                                                                                                                          | `src/session-kill-diagnostics.lib.mjs`                                                                                                               |
| RC3 (upstream)   | Reported with reproduction, workaround and suggested fix: derive memory exhaustion from `oomKilled` only for a SIGKILL exit (137), as `isKilledExit()` already does.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [link-foundation/start#180](https://github.com/link-foundation/start/issues/180)                                                                     |
| Owner feedback   | A random 30–90 s delay before every automatic recovery (`--session-kill-resume-delay`), and the container cgroup memory limit and OOM counters in every resource snapshot and kill diagnosis. See "Follow-up: owner feedback on PR #2499".                                                                                                                                                                                                                                                                                                                                                                             | `src/session-kill-policy.lib.mjs`, `src/session-kill-resume.lib.mjs`, `src/solve.tool-kill-resume.lib.mjs`, `src/solve.resource-diagnostics.lib.mjs` |

Regression test: `tests/issue-2498-oom-false-positive.test.mjs`, using the real log tail as fixture `tests/fixtures/issue-2498/session-log-tail.txt`. Five of its six tests fail on the code before this PR and all six pass after it. It covers:

- `describeKillCause`;
- the Telegram sections;
- the PR notice;
- `announceKillOnPullRequest`;
- a full `monitorSessions` pass with the exact `$ --status` record of the incident.

### Debug output

The data was enough to find the root causes of the false report: the start-command log, solve's timestamped log and the monitor's PR comment together give the full picture. The existing verbose line in `buildKillCompletionSections()` already prints `killed=… recovered=… oomEventOnly=… deliberateStop=<reason> cause=… policy=…`.

The data was **not** enough to answer the owner's follow-up question: whether one OOM event killed several tasks at once (see below). Every memory figure in the logs was host memory (`os.totalmem()`, `/proc/meminfo`). Inside a container that is the host's RAM, not the container's limit. The monitor's own `collectSystemKillDiagnostics()` reads `/sys/fs/cgroup` of the _bot_ process, not of the task container. So this PR adds:

- `readCgroupMemory()` in `src/solve.resource-diagnostics.lib.mjs` reads the task's own cgroup: `memory.max`, `memory.current`, `memory.peak` and the `memory.events` counters `oom` and `oom_kill` (cgroup v2, with a v1 fallback);
- every resource snapshot logs `Container memory (cgroup v2): 2.7 GB used of 2.9 GB limit, peak 2.9 GB; processes killed by the OOM killer so far: 5`, and warns once `oom_kill > 0`;
- the `📈 [RESOURCES]` marker carries `cgroupVersion`, `cgroupMemLimitBytes`, `cgroupMemCurrentBytes`, `cgroupMemPeakBytes`, `cgroupOomEvents` and `cgroupOomKills`, and older markers still parse;
- `describeKillCause()` quotes the last reading as evidence: "last session container cgroup reading — … 5 process(es) killed by the OOM killer, memory.events oom=2".

Per the [kernel cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files), `oom` counts allocation attempts reaching the limit and `oom_kill` counts processes killed by any OOM killer. They measure different things. With `memory.oom.group=1`, one container OOM can kill several processes; neither their ratio nor `oom_kill > 1` establishes the number or scope of OOM incidents. Correlating task cgroups, counter changes and attributed kernel records is necessary. Tests: `tests/issue-2498-cgroup-memory-diagnostics.test.mjs` and `tests/issue-2498-start-status.test.mjs`.

## Follow-up: owner feedback on PR #2499

The owner asked three things ([copy](./pr-2499-feedback.md)):

1. "Or may be it actually worked as expected as one out of memory event may have killed multiple tasks at once", pointing at [meta-language#196](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5985077141).
2. "On recovery from out of memory event we don't do it all at the same time and have some random interval from 30 to 90 seconds".
3. "Update to the latest versions of all dependencies + check that https://github.com/link-foundation/start has exactly all the features we need".

### Did one OOM event kill several tasks?

A second session ran on the same bot and host at the same time: link-foundation/meta-language#196, session `48959e41-…`, solve v2.33.11. Its 56 MB log was downloaded; the relevant lines are in [`meta-language-196-log-excerpt.txt`](./meta-language-196-log-excerpt.txt).

| Time (UTC) | package-registry-manager#27 (`bebf2e57-…`)                     | meta-language#196 (`48959e41-…`)                                                                                                                                                                               |
| ---------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19:32:49   | monitor sees `oomKilled=true` (a cargo build)                  |                                                                                                                                                                                                                |
| 19:33:22   |                                                                | Claude runs `formal-ai-corpus-memory` on two inputs in a loop under `ulimit -v 8000000` (8 GB)                                                                                                                 |
| 19:36:48   |                                                                | monitor sees `oomKilled=true`                                                                                                                                                                                  |
| 19:37:53   |                                                                | the tool result shows **both** runs `Killed` (pids 706741, 706773), `Exit code 137`                                                                                                                            |
| 19:37:58   |                                                                | Claude retries on three smaller inputs under `ulimit -v 4000000` (4 GB)                                                                                                                                        |
| 19:38:41   | `rustc` (`chromiumoxide_cdp`) killed with SIGKILL              |                                                                                                                                                                                                                |
| 19:40:42   | **Claude: "OAuth session expired and could not be refreshed"** |                                                                                                                                                                                                                |
| 19:41:03   | solve exits 1                                                  |                                                                                                                                                                                                                |
| 19:44:03   |                                                                | the tool result shows **all three** runs `Killed` (pids 707082, 707116, 707139), `exit 137`; in the same second Claude returns `authentication_failed`: **"OAuth session expired and could not be refreshed"** |
| 19:44:11   |                                                                | solve exits 1; the PR gets the same misleading "⚠️ Container OOM event during a failed work session" notice ([copy](./meta-language-196-comment-5983729348.md))                                                |

What the evidence shows:

- **Several child processes were killed while the main processes survived.** The meta-language log shows five `formal-ai-corpus-memory` runs returning SIGKILL/137, and package-registry-manager shows a killed `rustc`. Docker’s flags establish container OOM observations, but the old logs cannot attribute every individual SIGKILL to an OOM or correlate the two containers to one event. The sequential loop retries rule out one simultaneous group kill as the explanation for all five recorded child deaths.
- **Container limits are plausible; a shared host or parent OOM remains possible.** The configured default `DEFAULT_DOCKER_TASK_MEMORY = '25%'` would give about 2.9 GB on this 11.7 GB host. A different contemporary task reads `memory.max = 3135373312`, consistent with that default. This does not measure either affected container. The 8 GB and 4 GB address-space limits in the experiments are also above the default. Healthy host memory samples between kills cannot rule out brief host-wide pressure between snapshots.
- **Host RAM was mistaken for the task’s limit.** The notice’s "10.4 GB of 11.7 GB RAM available" describes host memory; the actual task limit was absent. New task cgroup snapshots and upstream watcher counters make that distinction explicit.
- **Both terminal logs name authentication failure.** Claude reports expired OAuth sessions at 19:40:42 and 19:44:03, and solve deliberately exits 1. This is the recorded stop reason in both sessions. Shared credentials are an operational possibility, but the logs do not establish why refresh failed or whether earlier memory pressure contributed.

So the OOM _detection_ worked as expected, and the policy worked as expected: no recovery for a deliberate stop (#2408). What did not work was the _report_, which named the OOM event as the reason for an authentication stop, in both sessions. The fix in this PR applies to both.

### Recovery: a random 30–90 s delay

Every automatic recovery now waits its own random delay before it starts. This way sessions killed by one event, for example a host-wide OOM, do not all rebuild their memory, CPU and API load in the same second:

- **monitor-driven recovery** (a killed session resumed in place or in a fresh session): `startKillRecoverySession()` in `src/session-kill-resume.lib.mjs` sleeps before the launch. The monitor handles each session under its own in-flight guard, and ticks may overlap, so one session's wait does not hold up the others.
- **in-process recovery** (solve resumes the tool after the tool was OOM-killed, #2301/#2408): `resumeAfterToolKill()` in `src/solve.tool-kill-resume.lib.mjs` logs `⏳ Waiting 47s before resuming, so recoveries from one out-of-memory event do not start at the same moment` and sleeps.
- The range is set by `--session-kill-resume-delay` (default `30-90`) or `HIVE_MIND_SESSION_KILL_RESUME_DELAY`. A single number is a fixed delay, `0` turns the delay off, a reversed range is normalised, and an invalid value falls back to the default. Documented in `docs/CONFIGURATION*.md`.
- Tests: `tests/issue-2498-recovery-delay.test.mjs` covers the range, the configuration, the order sleep → launch, different delays for three sessions killed together, no wait for a refused recovery, and the in-process path.

start-command 0.35.2 adds a cancellable `--on-kill-resume-delay` for its own recovery. Hive Mind retains its own delayed recovery because it checks deliberate stops, persists attempt budgets and chooses guarded same-container or fresh-session recovery. Enabling both schedulers would create competing resumes. A `/stop` during Hive Mind’s wait cancels the pending launch.

### Dependencies and start-command features

Rechecked on 2026-10-05 after the latest owner comment ([copy](./pr-2499-latest-feedback.md)).

- `npm ci` completed with zero audit vulnerabilities; `npm outdated --json` is empty. The repository’s dependency freshness check covers direct npm dependencies, dynamic `use-m` imports, image and tool pins, Node/Bun, GitHub Actions and FormalAI. Before the update, 165/168 declarations were current: only three start-command image pins were stale. After updating all three, 168/168 are current ([before](./dependency-freshness-before.txt), [after](./dependency-freshness-after.txt)). No other dependency declaration needed changing.
- `Dockerfile`, `Dockerfile.dind` and `Dockerfile.e2e` now pin `start-command@0.35.2`. The related pin tests are updated. The existing patch changeset prepares the next Hive Mind release.
- Upstream [PR #184](https://github.com/link-foundation/start/pull/184) and release js-0.35.2/rust-0.22.2 resolve #180, #181 and #182: an earlier container OOM no longer explains ordinary exits, native recovery supports a cancellable random delay, and the detached watcher saves per-task cgroup counters before the cgroup disappears. Existing Docker isolation, runtime memory reasons and resource-preserving resume remain available.
- Hive Mind now retains the new nullable `cgroupMemory` object in JSON status/list and links-notation status. Counters reach diagnostics even without a final solve snapshot. The monitor uses a positive kill count as an observation, while the authoritative footer and backend liveness still win. SIGTERM/SIGABRT keep their actual classification even after an earlier OOM. Bot cgroup counters and unrelated host victims remain labelled context.
- The published upstream package was exercised directly with `experiments/issue-2498-start-command-contract.cjs` ([output](./upstream-contract.txt)). The raw counters work, but upstream derives OOM scope by comparing process kills with allocation events. This is insufficient evidence, reported as [start#185](https://github.com/link-foundation/start/issues/185) with a bounded reproduction, workaround and suggested fix ([report](./upstream-start-oom-scope.md)). Upstream fixed it in [PR #186](https://github.com/link-foundation/start/pull/186), released as JavaScript 0.35.3 and Rust 0.22.3. This follow-up consumes 0.35.3. Hive Mind reports raw quantities without that scope inference.
- The watcher’s 1-second sampling is best effort: a cgroup disappearing between reads can lose the final increment; remote Docker daemons, unsupported cgroups or inaccessible `/proc` leave fields unknown. Solve’s cgroup v1/v2 phase snapshots provide complementary evidence. Neither source proves host scope without correlation.
- Added regressions cover status/list parsing, nullable counters, footer/liveness precedence, distinct signals/runtime limits, unrelated bot/host evidence, stop cancellation during recovery, actual parsed CLI environment precedence and timer overflow. The original authentication-stop fixture still passes. Reproducing failures and final results are archived in this folder, including a missed-final-sample regression ([before](./last-sample-reproduction-before.txt)).

## Existing components and facts used

- **Docker / moby**: `State.OOMKilled` is container-wide and sticky (moby/moby#43564). A main process that is OOM-killed exits 137. A child that is OOM-killed while PID 1 survives leaves exit codes unchanged ([Netdata: Docker OOMKilled](https://www.netdata.cloud/guides/docker/docker-oomkilled/), [Netdata: exit code 137](https://www.netdata.cloud/guides/docker/docker-exit-code-137/)).
- **cgroup v2 `memory.events`**: `oom_kill` counts every OOM kill in the cgroup. It measures killed processes cumulatively, rather than incident times or scope, but it is only available from inside the container or from the host cgroup path.
- **Claude Code OAuth**: the exact terminal message is "OAuth session expired and could not be refreshed". The logs prove the authentication stop, but do not identify whether credentials expired, were revoked or raced during refresh. Reauthentication is the indicated operational action; this PR does not change authentication handling.
- **hive-mind building blocks reused**:
  - `detectDeliberateSolveStop()` / `DELIBERATE_STOP_MARKERS` (#2408);
  - `resolveOomKilledState()` (#2134, #2408);
  - `buildKillRecoveryNotice()` (#2134);
  - `lino-i18n` locale files.

## Remaining uncertainty and possible follow-ups

- The 19:32 event: the monitor observed the flag at 19:32:49, during `cargo clippy` running alongside a background cargo build. Clippy's output was piped through `grep | head`, so the log does not name the victim. The 19:38:41 `rustc` SIGKILL is the one directly visible in the log.
- Whether memory pressure contributed to the OAuth refresh failure cannot be proven or ruled out from these logs. No error in the log establishes that connection, and token-lifetime details were not captured.
- Possible improvement (not done here): name the OOM victims by scanning the log for `(signal: 9, SIGKILL: kill)` next to compiler commands. The PR notice could then say "rustc was OOM-killed at 19:38". The count of victims is now available from `memory.events` (see "Debug output").
- The resource snapshots are taken at solve's phase boundaries (start, after clone, after the agent, exit), not continuously. A host-wide OOM between two samples cannot be fully ruled out for the 19:32–19:44 window; new task counters improve evidence, but kernel/cgroup correlation is still required to establish scope.
- Running parallel `cargo` builds of large crates in a container with a smaller task memory limit will keep producing OOM kills. Limiting `CARGO_BUILD_JOBS` in the container image is a separate, operational change.

## Follow-up: recovery visibility (2026-10-05)

The owner’s [second feedback comment](https://github.com/link-assistant/hive-mind/pull/2499#issuecomment-6001743889) ([archive](./pr-2499-feedback-recovery-visibility.md)) asks to update every dependency, distinguish restarted tasks from actively working tasks, explain failure comments followed by recovery, show the entire sequence in Telegram/GitHub/start-command logs, and report missing start-command features upstream. The [previous solution draft’s complete log](./pr-2499-second-solution-draft-log.txt.gz) is archived, including its investigation and checks.

### Additional root causes and evidence

1. Explicit in-place resume retains the execution UUID and appends to the same start-command log. The monitor previously accepted the latest exit footer even when it belonged to the killed attempt. Consequently an alive replacement could be completed/untracked using its predecessor’s exit 137. The reproducer exercises three paths: executing status with and without an OOM flag, and a terminal failure record contradicted by backend liveness. All three fail before the fix. This is a demonstrated mechanism for lost monitoring; it does not prove that every quiet session mentioned by the owner had this cause.
2. The new tracked record inherited the previous log path and completion/tool-ID caches. A fresh launch must discover its own log, and every attempt needs fresh completion state. In-place launches now persist their pre-launch byte boundary and attempt start time. Footer reads, stop-marker detection and diagnostic excerpts exclude earlier attempts; a timestamp fallback protects records with a usable attempt time but no byte boundary. Current byte-scoped footers remain authoritative across clock differences.
3. A successful launch command was described as “recovered”, with “Progress below continues” before activity was observed. In-process retries posted a warning before running but did not publish the eventual retry result. A quiet pending attempt had no periodic lifecycle update. The final formatter and completion audit could call a recovery successful when no terminal exit code was available. Unknown outcomes now remain null in durable history, including completion-latch restoration. Those statements are now bounded by the evidence actually observed. The full-suite command-stream guard also caught a raw stderr fallback in publication diagnostics ([failure](./recovery-publication-fallback-before.txt)); it now reads stream text explicitly.

[The five initial failing regressions](./recovery-lifecycle-before.txt) reproduce lost tracking, premature recovery wording and missing retry outcomes. A [separate failing regression](./recovery-unknown-outcome-before.txt) covers missing terminal evidence. Follow-up regressions reproduce [tool-result eviction from the bounded tail](./recovery-result-tail-before.txt) and [a manufactured exit 0 in completion history](./recovery-unknown-audit-before.txt). The [expanded passing regressions](./recovery-lifecycle-after.txt) cover byte-scoped evidence, restored comment handles, heartbeat throttling, quiet/output distinctions, publication retry, enclosing-run results, timer cleanup, exceptions, retained results after log-tail eviction and fresh-launch cache/limit preservation.

### What users now see

| Stage                    | Evidence and reporting                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original attempt stopped | Its actual exit/cause is preserved. An earlier child OOM does not become the cause of an authentication or deliberate stop.                                                                                                        |
| Recovery scheduled       | GitHub and the Telegram task reply show the attempt and delay before launch. A user stop during this delay still cancels the launch.                                                                                               |
| Launch accepted          | The notice names the replacement, says the launch was accepted, and leaves activity/final outcome pending. The original failed attempt and a pending replacement are distinct outcomes.                                            |
| Under monitoring         | Phase changes and five-minute heartbeats update the same durable GitHub lifecycle comment and Telegram task reply. Existing kill diagnostics/log-upload notices remain available.                                                  |
| Output observed          | A bounded read detects new execution output and gives its timestamp. Lifecycle heartbeat records themselves do not count as agent activity. Output alone does not prove commits, useful progress or success.                       |
| Quiet or unreadable log  | The update explicitly says no new output was observed, or that the log is unavailable. A quiet run may be working or stalled; it is not labelled failed merely for being quiet.                                                    |
| Attempt ends             | The actual success/failure/stop is reported; tool-attempt results are distinguished from the enclosing solve’s final result. Missing terminal exit evidence is an unknown outcome. Further recovery, if launched, remains pending. |

The in-process retry writes structured `[HIVE-MIND RECOVERY]` records for scheduling, launch, heartbeat and result to solve output, which start-command captures. The monitor also appends structured lifecycle records to the execution log and emits `session_recovery_lifecycle` through the existing bot logger. Attempt number, timestamps, execution/session identifiers, observed output, exit code and reason allow the sequence to be joined. Publication errors are logged and retried on the next monitor tick. The persisted lifecycle state retains its comment URL and throttle after a bot restart. New bookkeeping comments use a central automation marker so they do not count as AI solution comments.

**Why can a failure comment precede recovery?** A failure comment can describe the attempt that ended. The surviving bot or enclosing solve process can subsequently launch a separate attempt. The earlier process is not resurrected: the replacement either re-enters its saved filesystem/session or starts fresh. Previous code conflated launch acceptance with completed recovery and could then lose tracking through the old footer. The new sequence explicitly identifies the predecessor, replacement and pending/result stages. In the original package-registry-manager run, the final authentication failure remained a genuine stop; the earlier child OOM did not warrant restarting that stopped task.

### Dependencies and upstream report

The authenticated [freshness audit](./dependency-audit-2026-10-05-follow-up.txt) reports **168/168 declarations current**. The five stale declarations were three Docker pins for start-command 0.35.2 → 0.35.3, `command-stream` 1.3.0 → 1.5.0 and `@dotenvx/dotenvx` 2.32.4 → 2.33.0 in the dynamic loader. Direct package.json dependencies and the existing lockfile were already current; `npm ci` found zero vulnerabilities. Pin-specific tests and preinstallation use the updated versions. The existing patch changeset prepares the next release.

A finite reproduction against the actual exported `resumeExecution()` in npm start-command 0.35.3 confirms that the saved resumed record retains old `memoryExhausted`, its reason and cgroup counters, and does not append an explicit-resume boundary to the shared log. The script uses a successful mocked Docker launch and no-op watcher; it does not create containers or cause an OOM. See [script](../../../experiments/issue-2498-start-resume-state.mjs), [captured output](./start-0.35.3-resume-state.json), and the new [start#187](https://github.com/link-foundation/start/issues/187) ([report archive](./upstream-start-187-explicit-resume.md)). The report requests attempt-scoped fields/history, a log boundary, accepted-launch/watcher/terminal records and activity timestamps. Previous reports #180–#182 and #185 are closed; the relevant releases are consumed here.

### Limits of this verification

Activity reporting observes execution output, not semantic completion or guaranteed commits. Heartbeats depend on the bot/process running and successful Telegram/GitHub delivery; a monitor tick and network latency can delay publication. Old persisted records without a trustworthy attempt timestamp or log boundary cannot be fully reconstructed locally. Upstream #187 is still needed for complete attempt metadata outside Hive Mind. Tests use mocked external services and bounded real log files; local checks do not reproduce host-wide OOM pressure or deploy the Telegram bot. The case study retains all original evidence and features, including bounded recovery, randomized delays, stop cancellation and opt-in log uploads.

The [pre-publication validation snapshot](./follow-up-validation.txt) links the complete [default-suite investigation](./follow-up-default-investigation.log.gz) and [GitHub integration run](./follow-up-github-integration.log.gz). The full clean replay and current-commit CI results are recorded in [PR #2499](https://github.com/link-assistant/hive-mind/pull/2499).
