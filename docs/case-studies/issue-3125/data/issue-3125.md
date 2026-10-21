# #3125 [auto-fix] Task container killed by its memory limit (cgroup OOM)
labels: []
auto-fix found 1 task attempt(s) that died with signature **cgroup-oom**.


Versions: hive-mind 2.35.3, start-command 0.36.0. Host now: 142.6 GiB disk free of 192.7 GiB, 8.4 GiB memory available of 11.7 GiB, load 8.53 9.25 7.51, Docker live-restore true.

Bot log: https://gist.github.com/konard/942b1cd46827addaa1ee200522a06a0a


### https://github.com/link-foundation/links-notation/issues/340 — attempt 1

| | |
|---|---|
| Execution | `6931575d-380b-481f-acb4-2095e05ba8c6` (attempt 1, now `executed`) |
| Container | `a200bdc6-0f93-4ba8-b583-12ca64f28bc9` — exited, exit 137, OOMKilled true |
| Exit | 137 (signal (SIGKILL; cause unknown)); detected as **killed**, signature **cgroup-oom** |
| Ran | 2026-10-11T08:14:43.521Z → 2026-10-11T09:24:02.592Z |
| Memory limit | 2.9 GiB |
| Writable layer | 1006.9 MiB |
| Auto-recovered | no: 1 later attempt(s) did not finish properly |
| start-command log | 10.3 MiB — [uploaded](https://gist.github.com/konard/3d0921cc4f8b2e7773199d3039037086); ends like Docker's own log |

**Work left in the container**

- `/tmp/gh-issue-solver-1791706524165/` on `issue-340-f295191f6144`: 10 uncommitted file(s), 0 unpushed commit(s), last commit 2026-10-11T09:18:48+00:00

<details><summary>Attempts, recovery and lifecycle lines</summary>

```
1: executed exit 137 (signal (SIGKILL; cause unknown)) a200bdc6-0f93-4ba8-b583-12ca64f28bc9 2026-10-11T08:14:43.521Z → 2026-10-11T09:24:02.592Z
2: executed exit 127 a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1 2026-10-11T09:25:19.096Z → 2026-10-11T09:32:18.630Z
```
```
        "signature": "CAQS0gUKEAgSGAI4AUIIdGhpbmtpbmcSDD7pXjK1D+XsSZz2qxoMzM7pR9fnstWcMAPEIjB6TLcfYjqDsEhOKKPKaRl6ahnDVtyMyXzYGAuVDuZZluv5RUyvFG3U2FvmNQjcCkIq7wTbCx8LLrQZ1uJ9i6W+NQH4aufr6UWxYV/bF//zlW7jq97dNI2z41KsUxR9XpzWUqggwv3TGWFaT15I0cr2vNiG3hopbH78SzrGztAz9bKm1NwArqJV0kdeDQmFUFjdHvSgxiWy/rbpVwDpXjkAxBV30w8v7624ksXyBE8fFF6g4BJOlBs/ULuCKcdJvJ+WXN80Xf1116avQO381HCBtXtQ1KKIrWJ3NJrRk1SGLUddfDCMG6 …
        "content": "Exit code 1\n\nIn experiments/issue-197/run.sh line 36:\nrun_if_available cmake C++ bash -c 'build=\"$(mktemp -d)\" && trap \"rm -rf \\\"$build\\\"\" EXIT &&\n                                   ^-- SC2016 (info): Expressions don't expand in single quotes, use double quotes for that.\n\nFor more information:\n  https://www.shellcheck.net/wiki/SC2016 -- Expressions don't expand i …
  "tool_use_result": "Error: Exit code 1\n\nIn experiments/issue-197/run.sh line 36:\nrun_if_available cmake C++ bash -c 'build=\"$(mktemp -d)\" && trap \"rm -rf \\\"$build\\\"\" EXIT &&\n                                   ^-- SC2016 (info): Expressions don't expand in single quotes, use double quotes for that.\n\nFor more information:\n  https://www.shellcheck.net/wiki/SC2016 -- Expressions don't …
⚠️ Tool result error detected: Exit code 1
Killed
❌ Claude command failed with exit code 137
   Container memory (cgroup v2): 2.9 GB used of 2.9 GB limit, peak 2.9 GB; processes killed by the OOM killer so far: 1
   ⚠️  The kernel OOM killer has killed 1 process(es) in this container's cgroup; memory.events oom=1
📈 [RESOURCES] phase=after_agent ts=2026-10-11T09%3A23%3A29.719Z load1=18.35 load5=7.77 load15=6.31 cpuCount=6 memTotalBytes=12541489152 memAvailableBytes=7740231680 memUsedBytes=4801257472 processRssBytes=156610560 processHeapUsedBytes=32669304 processHeapTotalBytes=40493056 processExternalBytes=25447377 processHeapLimitBytes=1668546560 processHeapUsedPercent=1.9579497979367144 diskPath=%2F diskT …
Exit evidence: unavailable (no attributed exit-time OOM or daemon restart evidence)
Exit Code:  137 (SIGKILL - 128+9)
OOMKilled:  true
Memory:     memory.max=3135369216 memory.peak=3135373312 oom=1 oom_kill=1 (OOM kill scope unknown)
Reason: exitCode=137 oomKilled=true
Exit Code: 137
[HIVE-MIND RECOVERY] {"kind":"container","phase":"waiting","attempt":1,"delayMs":46798,"at":"2026-10-11T09:24:28.963Z"}
[HIVE-MIND RECOVERY] {"kind":"container","attempt":1,"startedAt":"2026-10-11T09:24:28.965Z","lastReportedMs":0,"lastBytes":10771799,"phase":"waiting","outerTerminal":false,"at":"2026-10-11T09:24:28.965Z","sessionName":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9","previousSession":null,"executionUuid":"6931575d-380b-481f-acb4-2095e05ba8c6","logAvailable":true,"delayMs":46798,"exitCode":null,"reason":null …
[HIVE-MIND RECOVERY] {"kind":"container","phase":"launching","attempt":1,"at":"2026-10-11T09:25:17.164Z"}
[HIVE-MIND RECOVERY] {"kind":"container","attempt":1,"startedAt":"2026-10-11T09:24:28.965Z","commentUrl":"https://github.com/link-foundation/links-notation/pull/342#issuecomment-6107559187","lastReportedMs":1791710668965,"lastBytes":10772328,"phase":"launching","outerTerminal":false,"at":"2026-10-11T09:25:17.165Z","sessionName":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9","previousSession":null,"executi …
```

</details>

<details><summary>Kernel and Docker daemon journal around the exit</summary>

```
2026-10-11T11:23:24+02:00 vmi2955137 kernel: runc:[2:INIT] invoked oom-killer: gfp_mask=0xcc0(GFP_KERNEL), order=0, oom_score_adj=0
2026-10-11T11:23:24+02:00 vmi2955137 kernel: oom-kill:constraint=CONSTRAINT_MEMCG,nodemask=(null),cpuset=docker-f2c8ed2e036a5c709886dd50cd3928cbab3d881c5a6f708057bff9f214177270.scope,mems_allowed=0,oom_memcg=/system.slice/docker-f2c8ed2e036a5c709886dd50cd3928cbab3d881c5a6f708057bff9f214177270.scope,task_memcg=/system.slice/docker-f2c8ed2e036a5c709886dd50cd3928cbab3d881c5a6f708057bff9f214177270.sco …
2026-10-11T11:23:24+02:00 vmi2955137 kernel: Memory cgroup out of memory: Killed process 2369363 (claude) total-vm:5614600kB, anon-rss:228088kB, file-rss:130136kB, shmem-rss:0kB, UID:1001 pgtables:1524kB oom_score_adj:0
2026-10-11T11:24:01+02:00 vmi2955137 kernel: cc1plus invoked oom-killer: gfp_mask=0x100cca(GFP_HIGHUSER_MOVABLE), order=0, oom_score_adj=0
2026-10-11T11:24:01+02:00 vmi2955137 kernel: oom-kill:constraint=CONSTRAINT_MEMCG,nodemask=(null),cpuset=docker-f2c8ed2e036a5c709886dd50cd3928cbab3d881c5a6f708057bff9f214177270.scope,mems_allowed=0,oom_memcg=/system.slice/docker-f2c8ed2e036a5c709886dd50cd3928cbab3d881c5a6f708057bff9f214177270.scope,task_memcg=/system.slice/docker-f2c8ed2e036a5c709886dd50cd3928cbab3d881c5a6f708057bff9f214177270.sco …
2026-10-11T11:24:01+02:00 vmi2955137 kernel: Memory cgroup out of memory: Killed process 2350797 (node-MainThread) total-vm:1786404kB, anon-rss:94996kB, file-rss:57216kB, shmem-rss:0kB, UID:1001 pgtables:1976kB oom_score_adj:0
```

</details>

<details><summary>Memory lines and the end of the log</summary>

```
   Memory: MemFree:         6117100 kB
   Memory: 7.2 GB available / 11.7 GB total (4.5 GB used)
   Process RSS: 149 MB, V8 heap: 31 MB used of 1.6 GB limit (2.0%)
   Container memory (cgroup v2): 2.9 GB used of 2.9 GB limit, peak 2.9 GB; processes killed by the OOM killer so far: 1
   ⚠️  The kernel OOM killer has killed 1 process(es) in this container's cgroup; memory.events oom=1
📈 [RESOURCES] phase=after_agent ts=2026-10-11T09%3A23%3A29.719Z load1=18.35 load5=7.77 load15=6.31 cpuCount=6 memTotalBytes=12541489152 memAvailableBytes=7740231680 memUsedBytes=4801257472 processRssBytes=156610560 processHeapUsedBytes=32669304 processHeapTotalBytes=40493056 processExternalBytes=25447377 processHeapLimitBytes=1668546560 processHeapUsedPercent=1.9579497979367144 diskPath=%2F diskT …
Memory:     memory.max=3135369216 memory.peak=3135373312 oom=1 oom_kill=1 (OOM kill scope unknown)
```
```
   CPU load: 18.35 7.77 6.31 (6 CPUs)
   Memory: 7.2 GB available / 11.7 GB total (4.5 GB used)
   Process RSS: 149 MB, V8 heap: 31 MB used of 1.6 GB limit (2.0%)
   Disk (/): 146.2 GB available / 192.7 GB total (24.1% used)
   Container memory (cgroup v2): 2.9 GB used of 2.9 GB limit, peak 2.9 GB; processes killed by the OOM killer so far: 1
   ⚠️  The kernel OOM killer has killed 1 process(es) in this container's cgroup; memory.events oom=1
📈 [RESOURCES] phase=after_agent ts=2026-10-11T09%3A23%3A29.719Z load1=18.35 load5=7.77 load15=6.31 cpuCount=6 memTotalBytes=12541489152 memAvailableBytes=7740231680 memUsedBytes=4801257472 processRssBytes=156610560 processHeapUsedBytes=32669304 processHeapTotalBytes=40493056 processExternalBytes=25447377 processHeapLimitBytes=1668546560 processHeapUsedPercent=1.9579497979367144 diskPath=%2F diskT …
Exit evidence: unavailable (no attributed exit-time OOM or daemon restart evidence)
=== Container post-mortem ===
Container:  a200bdc6-0f93-4ba8-b583-12ca64f28bc9
Exit Code:  137 (SIGKILL - 128+9)
OOMKilled:  true
StartedAt:  2026-10-11T08:14:44.475969519Z
FinishedAt: 2026-10-11T09:24:02.592012581Z
Lifetime:   4158.117s
Error:      (none)
Memory:     memory.max=3135369216 memory.peak=3135373312 oom=1 oom_kill=1 (OOM kill scope unknown)
Container kept for investigation: a200bdc6-0f93-4ba8-b583-12ca64f28bc9
Reason: exitCode=137 oomKilled=true
Re-enter while running: $ --attach a200bdc6-0f93-4ba8-b583-12ca64f28bc9
Continue the stored command: $ --resume a200bdc6-0f93-4ba8-b583-12ca64f28bc9
Run another command in the same container: $ --resume a200bdc6-0f93-4ba8-b583-12ca64f28bc9 -- <command>
Remove when done: docker rm -f a200bdc6-0f93-4ba8-b583-12ca64f28bc9
==================================================
Finished: 2026-10-11 09:24:04.717
Exit Code: 137
[HIVE-MIND RECOVERY] {"kind":"container","phase":"waiting","attempt":1,"delayMs":46798,"at":"2026-10-11T09:24:28.963Z"}
[HIVE-MIND RECOVERY] {"kind":"container","attempt":1,"startedAt":"2026-10-11T09:24:28.965Z","lastReportedMs":0,"lastBytes":10771799,"phase":"waiting","outerTerminal":false,"at":"2026-10-11T09:24:28.965Z","sessionName":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9","previousSession":null,"executionUuid":"6931575d-380b-481f-acb4-2095e05ba8c6","logAvailable":true,"delayMs":46798,"exitCode":null,"reason":null …
[HIVE-MIND RECOVERY] {"kind":"container","phase":"launching","attempt":1,"at":"2026-10-11T09:25:17.164Z"}
[HIVE-MIND RECOVERY] {"kind":"container","attempt":1,"startedAt":"2026-10-11T09:24:28.965Z","commentUrl":"https://github.com/link-foundation/links-notation/pull/342#issuecomment-6107559187","lastReportedMs":1791710668965,"lastBytes":10772328,"phase":"launching","outerTerminal":false,"at":"2026-10-11T09:25:17.165Z","sessionName":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9","previousSession":null,"executi …
```


</details>

<details><summary>Bot log lines for this task</summary>

```
2026-10-11T09:32:16.914Z DEBUG Persisted session a200bdc6-0f93-4ba8-b583-12ca64f28bc9 {"command":"solve","url":"https://github.com/link-foundation/links-notation/issues/340"}
2026-10-11T09:32:16.915Z INFO  EVENT session_kill_recovery_launched {"sessionName":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9","recoverySessionId":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1","attempt":1,"maxAttempts":3,"policy":"resume"}
2026-10-11T09:32:16.920Z INFO  EVENT session_recovery_lifecycle {"kind":"container","attempt":1,"startedAt":"2026-10-11T09:24:28.965Z","commentUrl":"https://github.com/link-foundation/links-notation/pull/342#issuecomment-6107559187","lastReportedMs":1791711135591,"lastBytes":10782437,"phase":"launching","outerTerminal":true,"lastOutputAt":"2026-10-11T09:32:16.736Z","at":"2026-10-11T09:32:16.915Z", …
2026-10-11T09:32:18.449Z DEBUG Persisted session a200bdc6-0f93-4ba8-b583-12ca64f28bc9 {"command":"solve","url":"https://github.com/link-foundation/links-notation/issues/340"}
[VERBOSE] Session a200bdc6-0f93-4ba8-b583-12ca64f28bc9 is still being handled by an earlier monitor tick; skipping it this tick (issue #2408)
  "uuid": "6931575d-380b-481f-acb4-2095e05ba8c6",
[VERBOSE] isolation-runner: log footer for /tmp/start-command/logs/isolation/docker/6931575d-380b-481f-acb4-2095e05ba8c6.log reports exit 127 (finished 2026-10-11 09:32:19.086)
[VERBOSE] isolation-runner: docker writable layer size for 'a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1': 118784 bytes
2026-10-11T09:32:29.903Z DEBUG Persisted session a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1 {"command":"solve","url":"https://github.com/link-foundation/links-notation/issues/340"}
Session a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1 has finished. Sending notification to chat -1002975819706
[VERBOSE] Completion evidence for a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1: exitCode=127, status=failed, pullRequest=https://github.com/link-foundation/links-notation/pull/342, merged=false, mergedAt=unknown, logPath=/tmp/start-command/logs/isolation/docker/6931575d-380b-481f-acb4-2095e05ba8c6.log
[VERBOSE] log-bounded-read: scanned all 11 chunk(s) of /tmp/start-command/logs/isolation/docker/6931575d-380b-481f-acb4-2095e05ba8c6.log with no match
[VERBOSE] log-bounded-read: /tmp/start-command/logs/isolation/docker/6931575d-380b-481f-acb4-2095e05ba8c6.log is 10784798 bytes; using 2095930+2094612 char head/tail excerpt
2026-10-11T09:32:30.953Z INFO  EVENT session_recovery_lifecycle {"kind":"container","attempt":1,"startedAt":"2026-10-11T09:25:18.477Z","commentUrl":"https://github.com/link-foundation/links-notation/pull/342#issuecomment-6107559187","lastReportedMs":1791710717165,"lastBytes":10784798,"phase":"failed","outerTerminal":true,"lastOutputAt":"2026-10-11T09:32:19.224Z","at":"2026-10-11T09:32:30.950Z","se …
2026-10-11T09:32:32.142Z DEBUG Persisted session a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1 {"command":"solve","url":"https://github.com/link-foundation/links-notation/issues/340"}
2026-10-11T09:32:32.288Z DEBUG Persisted session a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1 {"command":"solve","url":"https://github.com/link-foundation/links-notation/issues/340"}
2026-10-11T09:32:32.289Z INFO  EVENT session_completion_notified {"sessionName":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1","exitCode":127,"status":"failed","notifiedAt":"2026-10-11T09:32:32.287Z"}
[VERBOSE] Session a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1 removed from tracking (exit: 127, status: failed)
2026-10-11T09:32:32.299Z DEBUG Removed session a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1 from snapshot {"status":"failed","exitCode":127}
2026-10-11T09:32:32.299Z INFO  EVENT session_completed {"sessionName":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9-resume-1","exitCode":127,"status":"failed"}
2026-10-11T09:32:39.316Z DEBUG Persisted session a200bdc6-0f93-4ba8-b583-12ca64f28bc9 {"command":"solve","url":"https://github.com/link-foundation/links-notation/issues/340"}
2026-10-11T09:32:39.317Z INFO  EVENT session_completion_notified {"sessionName":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9","exitCode":137,"status":"killed","notifiedAt":"2026-10-11T09:32:39.315Z"}
[VERBOSE] Session a200bdc6-0f93-4ba8-b583-12ca64f28bc9 removed from tracking (exit: 137, status: killed)
2026-10-11T09:32:39.319Z DEBUG Removed session a200bdc6-0f93-4ba8-b583-12ca64f28bc9 from snapshot {"status":"killed","exitCode":137}
2026-10-11T09:32:39.320Z INFO  EVENT session_completed {"sessionName":"a200bdc6-0f93-4ba8-b583-12ca64f28bc9","exitCode":137,"status":"killed"}
```

</details>

<!-- auto-fix-key: 6931575d-380b-481f-acb4-2095e05ba8c6#1 -->


We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.

## comments
### konard 2026-10-17T04:06:31Z
Two more task attempts with this signature (Hive Mind 2.35.8, start-command 0.37.1). Both were killed by the task's own memory limit while the host had most of its memory free.

| Pull request | AI tool | Killed | Task cgroup | Host at the time |
|---|---|---|---|---|
| https://github.com/Godmy/stylist-svelte/pull/6 (container `d5173fa1-9c62-4b9b-979f-5748624f3860`, execution `1a664acf-1a63-4973-a4a7-32fc9088c98e` attempt 1) | Claude CLI exit 137 at 2026-10-13T21:44:49Z | 27 processes (chrome ×many, claude, node), `memory.events oom=430`, first OOM event 21:24:43Z | limit 2.9 GiB, peak 2.9 GiB | 10.5 GB of 11.7 GB available |
| https://github.com/links-games/master-plan/pull/2 (container `aba635de-8f93-480b-9796-22547b78d351`, execution `fd891c94-5166-45b7-9b3d-6a6846d654e5` attempt 1) | Codex exit 137 at 2026-10-15T21:00:46Z | `codex` (anon-rss 2.5 GB), `oom_kill=2` | limit 2.9 GiB, peak 2.9 GiB | 9.7 GB of 11.7 GB available |

Kernel line for the second one:

```
sqlx-sqlite-wor invoked oom-killer: ... oom-kill:constraint=CONSTRAINT_MEMCG ...
Memory cgroup out of memory: Killed process 2453721 (codex) total-vm:4879676kB, anon-rss:2537936kB
```

### Where 2.9 GiB comes from

`src/telegram-container-resource-limits.lib.mjs:9`: `DEFAULT_DOCKER_TASK_MEMORY = '25%'` (from #2301). The bot sets no `--container-memory` / `TELEGRAM_CONTAINER_MEMORY`, so every Docker task gets 25% of 11.7 GiB = 3 135 372 288 bytes (`docker inspect … HostConfig.Memory`), with `MemorySwap` equal to it (no swap). One Claude Code or Codex process plus a headless Chrome and a vitest/tsc run already need more than that, so tasks die at the hard limit while 7–10 GB stays unused.

### Consequences in these two runs

- stylist-svelte#6: the kill left 644 uncommitted files in submodules and 5 local-only commits in the container (#3433); the PR was then marked ready with its placeholder title and body (#3434), and the kill notice contradicted the recovery comment (#3435). Recovery failed with exit 127 (#2887).
- master-plan#2: 10 hours of work ended in exit 137; recovery failed with `bash: /codex: No such file or directory`, exit 127 (#2887).

### Suggested fix

- Make the hard limit a safety net, not a budget: default `--memory-reservation=25%` (soft, reclaimed under host pressure) plus a hard `--memory` of e.g. 60–75% of host RAM, or "host RAM minus a fixed reserve for the bot and dockerd" (e.g. total − 2 GiB). Keep `--container-memory` to override both.
- When a task's cgroup records its first OOM kill, say so in the PR and in Telegram while the session is still running (today it appears only in the final post-mortem), so a human can stop a heavy test run before the AI CLI itself is the next victim.
- Prefer killing the heaviest child (Chrome, vitest workers) over the AI CLI: set `oom_score_adj` for the AI CLI process lower than for its tool subprocesses.

Workaround on this server: start the bot with `--container-memory` set to a larger value. This is a deployment change, so I have not made it.

<!-- auto-fix-key: 1a664acf-1a63-4973-a4a7-32fc9088c98e#1 -->
<!-- auto-fix-key: fd891c94-5166-45b7-9b3d-6a6846d654e5#1 -->

