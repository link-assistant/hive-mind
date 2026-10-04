# Case study: issue #2498 — "Looks like we have false positive for OOM killing"

- Issue: https://github.com/link-assistant/hive-mind/issues/2498
- Affected run: https://github.com/link-foundation/package-registry-manager/pull/27
  - [comment 5983682088](https://github.com/link-foundation/package-registry-manager/pull/27#issuecomment-5983682088): solve's own "🚨 Solution Draft Failed" comment ([copy](./comment-5983682088.md))
  - [comment 5983686167](https://github.com/link-foundation/package-registry-manager/pull/27#issuecomment-5983686167): intermediate working-session log ([copy](./comment-5983686167.md))
  - [comment 5983686346](https://github.com/link-foundation/package-registry-manager/pull/27#issuecomment-5983686346): the misleading "⚠️ Container OOM event during a failed work session" notice ([copy](./comment-5983686346.md))
- Upstream reports filed from this case:
  - [link-foundation/start#180](https://github.com/link-foundation/start/issues/180): `memoryExhausted` derived from the sticky flag;
  - [link-foundation/start#181](https://github.com/link-foundation/start/issues/181): random delay for `--on-kill-resume` ([copy](./upstream-start-181-recovery-delay.md));
  - [link-foundation/start#182](https://github.com/link-foundation/start/issues/182): per-container cgroup OOM counters in `--status` ([copy](./upstream-start-182-cgroup-oom-counters.md)).
- Owner feedback on PR #2499: [comment](https://github.com/link-assistant/hive-mind/pull/2499) ([copy](./pr-2499-feedback.md)), pointing at [link-foundation/meta-language#196 comment 5985077141](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5985077141) ([copy](./meta-language-196-comment-5985077141.md))

## Data in this folder

| File                                | What it is                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `failure-log.txt`                   | Full `solve` log, uploaded by solve itself (timestamped lines, 58 926 lines)                                                            |
| `intermediate-log.txt`              | The start-command log of the container, uploaded by the bot with the kill notice (comment 5983686167)                                   |
| `gist-log.txt`                      | The gist linked from the issue                                                                                                          |
| `comment-*.md`                      | Bodies of the three pull-request comments                                                                                               |
| `meta-language-196-*.md`            | The parallel session on link-foundation/meta-language#196: its failure comment, log comment, kill notice and the audit the owner linked |
| `meta-language-196-log-excerpt.txt` | The lines of that session's 56 MB log that show the OOM kills and the authentication stop, with links to the full logs                  |
| `pr-2499-feedback.md`               | The owner's review comment on PR #2499                                                                                                  |
| `upstream-start-*.md`               | Bodies of the upstream reports #181 and #182                                                                                            |

**Is the gist different from the logs in the comments?** No, apart from sanitisation. `gist-log.txt` and `intermediate-log.txt` are the same start-command log. If every 40-character hex SHA is replaced with a placeholder, the two files are identical: the only differences are commit SHAs, which the gist has in full and the bot's sanitised upload shortened to `abc…def` in some places (59 075 lines each). Both end with the same container post-mortem:

```
Exit Code:  1
OOMKilled:  true
StartedAt:  2026-10-04T18:59:06.159003017Z
FinishedAt: 2026-10-04T19:41:06.490191654Z
Reason: exitCode=1 oomKilled=true
```

`failure-log.txt` is solve's own log of the same run, with timestamps on every line. The timeline below is built from it.

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

- **Real:** there were OOM events. At least one `rustc` process inside the container was OOM-killed: `SIGKILL` at 19:38:41, with the monitor observing the cgroup flag at 19:32:49. The memory pressure came from parallel `cargo` builds of a large crate (`chromiumoxide_cdp`) in a container capped at 25% of the 11.7 GB host (2.9 GB, see "Did one OOM event kill several tasks?" below).
- **False:** the OOM events did not end the session. The work process (`solve`, then `claude`) outlived both of them and kept working. Eight minutes after the first one, it stopped because the **Claude OAuth session expired and could not be refreshed**. That is an account/authentication stop, which is the `subscription-blocked` deliberate stop of issue #2408.

So a real but harmless OOM event was presented as the reason for the failure, and the actual reason was hidden. That is the "false positive" the issue reports.

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
- `describeKillCause()` quotes the last reading as evidence: "last session container cgroup reading — … 5 process(es) killed by the OOM killer across 2 OOM event(s) at the container limit".

Per the [kernel cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files), `oom` counts how often the cgroup's own limit was hit, and `oom_kill` counts processes of the cgroup killed by _any_ OOM killer. `oom_kill` greater than `oom` therefore points to a host-wide OOM, and `oom_kill` greater than 1 shows that several processes were killed. Tests: `tests/issue-2498-cgroup-memory-diagnostics.test.mjs`.

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

- **Yes, several processes were OOM-killed per container.** In meta-language#196 five runs of `formal-ai-corpus-memory` were killed, and in package-registry-manager#27 at least one `rustc`. They were killed one after another (each loop iteration starts the next run after the previous one died), so these were several OOM kills inside one container, not one kill that took several tasks.
- **The two containers most likely hit their own limits rather than one host-wide OOM.** hive-mind caps each task container at `DEFAULT_DOCKER_TASK_MEMORY = '25%'` of host RAM (`src/telegram-container-resource-limits.lib.mjs`). On this 11.7 GB host (`memTotalBytes=12541493248`) that is 2.9 GB: a hive-mind task container on the same host reads `memory.max = 3135373312`, exactly 25%. The `ulimit -v` caps of 8 GB and 4 GB are above 2.9 GB. A process that hit its `ulimit -v` would get an allocation failure (a Rust abort, exit 134), not SIGKILL/137. The kills are therefore the cgroup's OOM killer at the 2.9 GB limit. Host memory stayed at 4.6–6.7 GB available in every sample of package-registry-manager#27, and at 10.4 GB available at the meta-language session's end.
- **The kill notice misled here too.** It says "10.4 GB of 11.7 GB RAM available". That is host RAM, and the meta-language audit read it as "11.7 GB limit". The real limit, 2.9 GB, was not in any log. That is why the cgroup reading was added (see "Debug output").
- **What really ended both sessions at almost the same time was not memory.** Both Claude CLIs failed to refresh the same account's OAuth token, 3 min 21 s apart (19:40:42 and 19:44:03). Both containers share the account's `~/.claude/.credentials.json`. Neither session would have ended at that point because of the OOM kills: in both, Claude was already reacting to the kills and retrying with smaller inputs or fewer jobs.

So the OOM _detection_ worked as expected, and the policy worked as expected: no recovery for a deliberate stop (#2408). What did not work was the _report_, which named the OOM event as the reason for an authentication stop, in both sessions. The fix in this PR applies to both.

### Recovery: a random 30–90 s delay

Every automatic recovery now waits its own random delay before it starts. This way sessions killed by one event, for example a host-wide OOM, do not all rebuild their memory, CPU and API load in the same second:

- **monitor-driven recovery** (a killed session resumed in place or in a fresh session): `startKillRecoverySession()` in `src/session-kill-resume.lib.mjs` sleeps before the launch. The monitor handles each session under its own in-flight guard, and ticks may overlap, so one session's wait does not hold up the others.
- **in-process recovery** (solve resumes the tool after the tool was OOM-killed, #2301/#2408): `resumeAfterToolKill()` in `src/solve.tool-kill-resume.lib.mjs` logs `⏳ Waiting 47s before resuming, so recoveries from one out-of-memory event do not start at the same moment` and sleeps.
- The range is set by `--session-kill-resume-delay` (default `30-90`) or `HIVE_MIND_SESSION_KILL_RESUME_DELAY`. A single number is a fixed delay, `0` turns the delay off, a reversed range is normalised, and an invalid value falls back to the default. Documented in `docs/CONFIGURATION*.md`.
- Tests: `tests/issue-2498-recovery-delay.test.mjs` covers the range, the configuration, the order sleep → launch, different delays for three sessions killed together, no wait for a refused recovery, and the in-process path.

start-command's own `--on-kill-resume` has no such delay. hive-mind does not use it (it runs its own recovery), but the gap is reported as [link-foundation/start#181](https://github.com/link-foundation/start/issues/181).

### Dependencies and start-command features

Checked on 2026-10-04:

- `npm outdated` (direct dependencies): empty. Every direct dependency and devDependency in `package.json` is already at its latest version. Only transitive packages pinned by their parents are behind. That is not something this repository controls.
- Global tools pinned in `Dockerfile`/`Dockerfile.dind`/`Dockerfile.e2e`: `start-command@0.35.1` and `@link-assistant/agent@0.26.11` are the latest npm releases. The other CLIs (Claude Code, Codex, Qwen, Gemini, OpenCode) are installed unpinned, so they are always latest.
- link-foundation/start: latest release js-0.35.1 / rust-0.22.1 (2026-10-03). hive-mind needs the following from it, and it is all present: detached Docker isolation, `--status` with `oomKilled`, exit code, `memoryExhausted`/`exitReason` (0.33.0, #164/#165), and resume that keeps resource limits (0.35.0, #176). The remaining gaps:
  - [#180](https://github.com/link-foundation/start/issues/180) (open): `memoryExhausted` is derived from the sticky flag for any exit code. hive-mind works around it in `describeKillCause()`.
  - [#181](https://github.com/link-foundation/start/issues/181) (new): no random delay for `--on-kill-resume`.
  - [#182](https://github.com/link-foundation/start/issues/182) (new): `--status` cannot report the container's cgroup `oom`/`oom_kill`/peak, because the cgroup is gone once the container stops. hive-mind now records these from inside the task.

## Existing components and facts used

- **Docker / moby**: `State.OOMKilled` is container-wide and sticky (moby/moby#43564). A main process that is OOM-killed exits 137. A child that is OOM-killed while PID 1 survives leaves exit codes unchanged ([Netdata: Docker OOMKilled](https://www.netdata.cloud/guides/docker/docker-oomkilled/), [Netdata: exit code 137](https://www.netdata.cloud/guides/docker/docker-exit-code-137/)).
- **cgroup v2 `memory.events`**: `oom_kill` counts every OOM kill in the cgroup. It is the precise source for "how many / when", but it is only available from inside the container or from the host cgroup path.
- **Claude Code OAuth**: "OAuth session expired and could not be refreshed" means the refresh token was refused (revoked session, very long idle/offline period, corrupt credentials, or a refresh race between two processes sharing `~/.claude/.credentials.json`). It needs `claude /login`. See anthropics/claude-code#72017 ("OAuth session expires every ~8 hours"). Nothing in the logs connects the OOM kills to the refresh failure: the refresh happens in the `claude` process, which was not killed.
- **hive-mind building blocks reused**:
  - `detectDeliberateSolveStop()` / `DELIBERATE_STOP_MARKERS` (#2408);
  - `resolveOomKilledState()` (#2134, #2408);
  - `buildKillRecoveryNotice()` (#2134);
  - `lino-i18n` locale files.

## Remaining uncertainty and possible follow-ups

- The 19:32 event: the monitor observed the flag at 19:32:49, during `cargo clippy` running alongside a background cargo build. Clippy's output was piped through `grep | head`, so the log does not name the victim. The 19:38:41 `rustc` SIGKILL is the one directly visible in the log.
- Whether memory pressure contributed to the OAuth refresh failure cannot be proven or ruled out from these logs. No error in the log suggests it, and the access-token lifetime explains it on its own.
- Possible improvement (not done here): name the OOM victims by scanning the log for `(signal: 9, SIGKILL: kill)` next to compiler commands. The PR notice could then say "rustc was OOM-killed at 19:38". The count of victims is now available from `memory.events` (see "Debug output").
- The resource snapshots are taken at solve's phase boundaries (start, after clone, after the agent, exit), not continuously. A host-wide OOM between two samples cannot be fully ruled out for the 19:32–19:44 window; the new cgroup counters will settle this for future incidents.
- Running parallel `cargo` builds of large crates in an 11.7 GB container will keep producing OOM kills. Limiting `CARGO_BUILD_JOBS` in the container image is a separate, operational change.
