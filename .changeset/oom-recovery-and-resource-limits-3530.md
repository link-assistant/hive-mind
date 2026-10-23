---
'@link-assistant/hive-mind': patch
---

Automatic recovery from OOM and other kills, Docker task resource limits, a persistent solve queue and safe auto-commits (#3530, #3532, #3533, #2843, #3435, #2809, #3125, #2838, #3048, #2892, #2900, #744, #733, #2917, #2890, #3572, #3656, #3433, #3434).

Kill and OOM recovery report less, wait for resources, never run a task twice, and use one id per task (#3530, #3532, #3533):

- A killed session gets one GitHub comment. It gives the reason and, with `--attach-logs`, the log, plus an "auto recovery is pending" note. The note is removed once the recovery starts, or replaced with the reason it did not start. Recovery progress (waiting, launching, attempt `n/m`) is shown only in Telegram, so no GitHub comment is auto-updated any more.
- The pending note is posted only when a recovery can be planned. Settling it is retried, a lost comment id is found by the notice's marker, and if the note cannot be edited and no recovery started, a short follow-up comment says why. The reasons are written in plain words.
- A recovery starts like every other session, with one start comment that says it is a resume or restart and which attempt it is.
- After a mass kill, a recovery waits until the task queue's resource limits pass several checks in a row (`HIVE_MIND_RECOVERY_RESOURCE_POLL_SECONDS`, `HIVE_MIND_RECOVERY_RESOURCE_STABLE_CHECKS`, `HIVE_MIND_RECOVERY_RESOURCE_MAX_WAIT_MINUTES`). `/stop` cancels the wait.
- A healthy in-place resume is no longer declared dead: liveness is probed by container name, not by execution UUID. No recovery or queued `/solve` starts while a container or another session of the same task is still running (#3532). A recovery that is being launched, or a direct `/solve` that is being launched, counts as running too, and a recovery respects the queue's one-at-a-time strategy.
- A host reboot or hard reset is named as the cause, once for all tasks it ended, with the real end time. A survived earlier OOM kill is listed separately instead of being blamed (#3533).
- One UUID per task: start-command's session, execution, log file and container share it, and the first fresh Claude Code session uses it via `--session-id`. A recovery in a new container is the next attempt of the same execution (`--append-attempt`), so the UUID and the log stay the same; only the container name changes. With a start-command older than 0.38.0 the recovery gets a new UUID and Telegram shows the latest one.
- `/log` on any id of a recovered task uploads every attempt's log, oldest first, in one sanitized file.
- The images install start-command 0.38.0, and links-notation is pinned to 0.27.1.
- A failed `solve` run with any tool (codex, agent, opencode, qwen, gemini) prints and records a working resume command with the issue URL; it was empty for non-Claude tools (#2843).

A kill notice on GitHub shows the real state of the recovery (#3435):

- The notice says only what is known when it is posted: "Automatic recovery started", not "a new working session was started". If no pending note was posted, the notice gives the reason no recovery started.
- When a recovery attempt fails too (for example exit 127), its outcome is added to the same kill notice instead of being reported nowhere. If the notice cannot be edited, a short comment is posted.
- The exit line names its process: `1 (solve); the AI tool (claude) exited 137 (SIGKILL, cgroup OOM)`.
- When solve already posted its own comment about the killed process, the monitor does not post a second notice for the same event.

An OOM event is reported on GitHub only when it happens, never after the work is finished (#2809):

- A container OOM event that the running session survives is reported once, about one poll after it is seen (so solve's own report comes first), with the log so far when `--attach-logs` is set. A late observation (older than 15 minutes) is not reported.
- A session that finishes well after a survived OOM event posts no OOM comment on GitHub; Telegram still mentions it.
- No kill or OOM comment and no recovery once the pull request is merged, closed, or its latest session posted "Ready to merge".
- Telegram shows how many OOM kills there were when there was more than one, for example "(9 OOM kills)".

Docker tasks are no longer OOM-killed while most host RAM is free, and an OOM kill takes the build, not the AI CLI (#3125):

- The default RAM limit for a Docker task is now a 60% hard limit with a 25% soft limit (`docker update --memory-reservation`), instead of a 25% hard limit. Under host memory pressure the kernel reclaims from tasks above their reservation first. Set it with `--container-memory-reservation` / `TELEGRAM_CONTAINER_MEMORY_RESERVATION`; an explicit `--container-memory` drops the default reservation, and `unlimited` opts out of either limit. The reservation is applied behind the fail-closed start gate and kept on resume and restart.
- Each bash shell the AI tool runs commands in raises its own `oom_score_adj` to 500 through a `BASH_ENV` hook, so the kernel kills a build or test run before the AI CLI. No privileges are needed. `HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ` changes the value or disables it (`off`).

Memory checks and prompts use the container's cgroup limit instead of host RAM (#2838):

- `solve` startup checks, resource diagnostics and the "System resources" lines read the cgroup v2 or v1 memory limit and usage, so a 4 GiB container on a 64 GiB host is reported and checked as 4 GiB.
- The AI tool prompts state the memory budget of the task's container and ask for builds and tests that fit in it (fewer parallel jobs, no memory-heavy commands in parallel).
- `hive` lowers `--concurrency` when the container memory limit cannot give each worker `--min-memory-per-worker` MB (default 2048, env `HIVE_MIND_MIN_MEMORY_PER_WORKER`, `0` disables), and says so at startup.

One busy Docker task no longer blocks every tool queue (#3048):

- Docker tasks are limited to 50% of the host CPUs by default (`--container-cpu`, `TELEGRAM_CONTAINER_CPU`; `unlimited` opts out). The bot warns at startup when Docker tasks run without a CPU limit.
- The queue's CPU gate treats the CPU a capped task uses as reserved for it and compares the remaining load with the CPUs capped tasks cannot use, so a task busy up to its cap does not hold back other tools. Uncapped load still blocks as before.
- The queue's `Starting:` log line shows the limits each task starts with, for example `[limits: CPU=50% (3 CPUs), RAM=60% (7.2 GiB), reservation=25% (3.0 GiB), disk=unlimited]`.

A task container killed by a Docker daemon restart is no longer reported as out of memory (issue #2892). Docker's `State.OOMKilled` flag is sticky: an earlier child-process OOM kill the container survived keeps it set. The session monitor now uses start-command's attributed exit reason before that flag. It also detects the restart from the log evidence, the docker.service journal, the dockerd start time, or the bot's own container having been killed in the same seconds. Such a session is reported as "killed by Docker daemon restart" in the PR notice, the kill diagnostics and Telegram, and kill recovery still runs.

The `--isolation docker` preflight now checks Docker live-restore (issue #2900). It warns, without blocking startup, when the task daemon or the mounted host daemon reports `LiveRestoreEnabled=false`, and gives the merge-and-reload fix (`systemctl reload docker`, never restart). docs/DOCKER.md and its ru/zh/hi translations gain a "Host Docker daemon settings" section, linked from the READMEs, and `Dockerfile.dind` pins `DIND_LIVE_RESTORE=1` for the nested daemon.

Guard the bot against broad process kills from AI sessions without Docker isolation (#744, #733): every tool's system prompt now says to stop only processes started by the session (by recorded PID) and never to run `pkill node`, `killall`, `kill -9 -1` or `kill 0`; Claude sessions always get `--disallowedTools 'Bash(pkill:*)' 'Bash(killall:*)'`; and the Telegram bot sets `process.title = 'hive-telegram-bot'` so `pkill node` and `killall node` no longer match it.

`/limits` and the solve queue count the docker task containers that are really running (#2917):

- Every `--isolation docker` task container gets `hive-mind.*` labels (tool, URL, command, session, bot instance) through start-command's `--label`, which start-command re-applies on `$ --resume`.
- Under docker isolation the processing count comes from `docker ps`: labelled containers, unlabelled task containers matched to a `$ --list` solve/hive record, and containers of tracked sessions. `pgrep` in the bot container (always 0 there) is ignored.
- Dispatch, the one-at-a-time limits and the kill-recovery resource gate use the larger of the queue's own count and the observed count, so a task the bot no longer tracks still blocks a second start of its tool.
- `/limits` shows untracked tasks, for example `codex (pending: 0, processing: 4, 2 untracked)`.
- The bot adopts running task containers it does not track (after a 2-minute grace period), so their completion is monitored and recorded. `HIVE_MIND_INSTANCE_ID` keeps bots that share one Docker daemon apart.

The Telegram bot's solve queue survives a bot or root container restart (#2890):

- Every queue change is saved to `~/.hive-mind/state/` (or `HIVE_MIND_STATE_DIR`): an atomic `queue.json`, a human-readable `queue.lino` projection and, when the link-cli `clink` tool is installed, a `queue.links` doublets database. Each copy can restore the queue alone. `HIVE_MIND_QUEUE_CLINK=0` disables the link-cli copy and `HIVE_MIND_CLINK_PATH` points to the binary.
- Queue events are also written to the bot log, so the queue can be rebuilt from the log (and from the older `Enqueued:` / `Starting:` / `raw text:` lines) when every store is gone.
- On launch the bot puts the queued tasks back in their original order with their chat, requester and message ids, restarts a task that was being launched only when no container or tracked session runs it, and tells each chat what was restored.
- The Docker docs describe the `/root/.hive-mind/state:/home/box/.hive-mind/state` volume that keeps the queue across `docker rm` and redeploys.

Claude subagent worktrees no longer reach the pull request, and a limit-reset resume no longer stops on them (#3572, #3656):

- `.claude/worktrees/` (created by Claude Code subagents with `isolation: "worktree"`) is AI tool state. It is written to `.git/info/exclude` at clone time and again when a `--working-directory` is reused, so it is never staged or reported as uncommitted.
- Every auto-commit path (claude, codex, agent, opencode, gemini, qwen, agent-commander) unstages any nested repository that `.gitmodules` does not list after `git add -A`, with a log line. A gitlink that an earlier run already pushed keeps its committed entry.
- The clean-tree check of a reused working directory ignores AI tool state. Real leftover work still stops the run, and the error now says "in the reused working directory" instead of "after clone".
- A reused working directory reports `Current branch` (the PR branch) and `Default branch` (from `origin/HEAD`), and the auto-merge merges the real default branch, fast-forwarded first, instead of merging the PR branch into itself.
- A status line whose leading space was trimmed away (` M .claude/…` read as `M .claude/…`) is still recognised as AI tool state.

Work inside git submodules is no longer lost or published as commits no remote has, and critical-error preservation is faster and better named (#3433, #3572, #3656):

- Every check for unsaved work (the restart and pre-session checks, session-change measurement and the uncommitted-changes feedback) now looks inside submodules, nested ones included. Each submodule with uncommitted files or with commits on no remote is listed as `## <path>: N uncommitted file(s), M commit(s) on no remote`, and the feedback says how to commit inside it.
- Critical-error preservation commits each dirty submodule first, innermost first, on `recovery/<branch>` and pushes it to that submodule's `origin` (or to a GitHub fork). Only then does it record the submodule pointer in the parent. If a submodule's commit reached no remote, the parent keeps its old pointer and the log and comment say so with `❌`.
- The kill/interrupt auto-commit of every tool does the same: it commits and pushes inside the submodules before the parent commits the pointer.
- Before a pull request is marked ready, every submodule pointer it changes must be fetchable from the URL in `.gitmodules`. Commits that are not are pushed under the PR branch name, or in fork mode to a fork with a pull request in the submodule repository, which is linked from the parent PR description. Anything still unreachable keeps the PR a draft, with a comment listing the pointers.
- The recovery branch is never `recovery/detached-head` (#3572). It is named after the PR branch solve already knows, even when the failure happens before that branch is checked out (the limit-reset resume of PR #3531). Without a known branch the checked-out one is used, and otherwise a unique `recovery/detached-<sha8>-<UTC time>`. The recovery branch is now pushed in all of these cases.
- Critical-error preservation starts its private index from a copy of the real one instead of `git read-tree HEAD` (#3656). `git add -u` then hashes only the changed files rather than every tracked file, which took 40 s on a loaded container, and staged-only new files are preserved too. When every uncommitted path is AI tool state (`.claude/worktrees/`, `.formal-ai/` …), the step is skipped before any index work.

A failed run no longer marks a placeholder pull request ready for review (#3434). At run end, a pull request left in draft stays a draft when its title still starts with `[WIP]` or its description is still the "Work in Progress" placeholder, and the log gives the reason in one line. If the title and description cannot be read, the pull request also stays a draft and the run does not fail. The placeholder checks now live in `pr-placeholder.lib.mjs`, shared by `verifyResults` and the run-end restore.

Images ship Node.js 26.12.1 (was 26.12.0), so the dependency freshness check passes again.
