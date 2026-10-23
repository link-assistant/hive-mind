# Case study: issue #3125, Docker tasks killed by their own memory limit

Issue: [#3125](https://github.com/link-assistant/hive-mind/issues/3125), "[auto-fix] Task container killed by its memory limit (cgroup OOM)". Related: [#2838](../issue-2838/README.md) (memory checks and prompts read the host, not the cgroup), [#3048](../issue-3048/README.md) (no default CPU limit), [#2887](../issue-2887/README.md) (the recovery that followed exited 127), [#2809](https://github.com/link-assistant/hive-mind/issues/2809) (live report of the first OOM kill), [#3530](../issue-3530/README.md) (OOM handling).

## Data

| File                                                                                                                   | What it is                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`data/issue-3125.md`](data/issue-3125.md)                                                                             | The issue body and comments as they were when this was written: the auto-fix report, journal lines, bot log      |
| [`../../../experiments/issue-3125-tool-shell-oom-score.mjs`](../../../experiments/issue-3125-tool-shell-oom-score.mjs) | Shows the `oom_score_adj` hook on a real Linux host: AI CLI, tool shell and build scores, and the kernel badness |

The execution logs are in private gists linked from the issue; they are not copied here.

## Timeline (UTC)

| Time                   | Event                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-11 08:14:43    | links-notation#340 starts in container `a200bdc6` with the default hard limit of 25% of 11.7 GiB = 2.9 GiB (`Memory = MemorySwap = 3135369216`)                                              |
| 2026-10-11 09:23:24    | The kernel kills `claude` in the task's cgroup (`CONSTRAINT_MEMCG`). The host still has 7.7 GB available                                                                                     |
| 2026-10-11 09:24:01–02 | `node-MainThread` is killed; the container exits 137, `OOMKilled true`, `memory.peak = memory.max`                                                                                           |
| 2026-10-11 09:25:19    | The in-place resume starts and exits 127 at 09:32:18. That failure is #2887, fixed in 2.35.10 and 2.37.1                                                                                     |
| 2026-10-13 21:24:43    | stylist-svelte#6: first OOM event in the task cgroup. Headless Chrome, vitest and `claude` share 2.9 GiB; `memory.events oom=430` by the end                                                 |
| 2026-10-13 21:44:49    | The Claude CLI is killed (exit 137) with 10.5 of 11.7 GB of the host available. 644 uncommitted files are left in submodules (#3433)                                                         |
| 2026-10-15 21:00:46    | master-plan#2: `sqlx-sqlite-wor` invokes the OOM killer and `codex` (anon-rss 2.5 GB) is the victim; 9.7 of 11.7 GB of the host available. Ten hours of work end in exit 137                 |
| 2026-10-17 04:06:31    | The maintainer traces the 2.9 GiB to `DEFAULT_DOCKER_TASK_MEMORY = '25%'` and suggests a soft reservation, a higher hard limit, a live first-OOM report and a lower OOM score for the AI CLI |

## Requirements

| #   | Requirement                                                                                                  | Status                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| R1  | Confirm the diagnosis (cgroup OOM of the task)                                                               | Correct already: kernel lines show `CONSTRAINT_MEMCG` kills in the task cgroup                     |
| R2  | Recovery after the kill must not fail with exit 127                                                          | Fixed earlier by #2887 (`tests/alias-recovery-2887.test.mjs`)                                      |
| R3  | Make the hard limit a safety net: a soft `--memory-reservation` of 25% and a higher hard `--memory` (60–75%) | Done: 60% hard limit, 25% reservation                                                              |
| R4  | Keep `--container-memory` as the override                                                                    | Done: it replaces the hard limit and drops the default reservation; reservation has its own option |
| R5  | Report the first OOM kill in a task's cgroup in the PR and in Telegram while the session still runs          | Not in this change: owned by the #2809 work                                                        |
| R6  | Prefer killing the heaviest child (Chrome, vitest, cargo) over the AI CLI via `oom_score_adj`                | Done: tool shells raise their own score to 500                                                     |
| R7  | Case study with the data, timeline, root causes and solutions                                                | This document                                                                                      |
| R8  | Report problems in other projects upstream                                                                   | One candidate for link-foundation/start, see [Upstream](#upstream)                                 |
| R9  | Apply the fix everywhere: launch, resume in place, resume in a new container, persistence, docs              | Done, see [Solutions](#solutions)                                                                  |

## Root causes

1. **The default hard limit was a budget, not a safety net.** `DEFAULT_DOCKER_TASK_MEMORY` was `'25%'` (from #2301) and `--memory-swap` equals `--memory`. On an 11.7 GiB host every task got 2.9 GiB with no swap. One Claude Code or Codex process, a headless Chrome and a vitest or `tsc` run need more than that, so tasks hit the hard limit while 7–10 GB of the host stayed unused.
2. **Nothing used a soft limit.** `buildDockerUpdateArgs` emitted only `--cpus`, `--memory` and `--memory-swap`. [#3530's case study](../issue-3530/README.md) described a `docker update --memory-reservation`, but no code set it. start-command up to 0.38.0 has no `--memory-reservation` launch flag either (start#236 is merged but not released).
3. **The AI CLI was a likely OOM victim.** All processes in a task start with `oom_score_adj` 0, so the kernel kills the process with the most memory. A long Claude Code or Codex session holds a large heap, so the CLI was often chosen (`claude` in links-notation#340 and stylist-svelte#6, `codex` in master-plan#2). Losing a build can be retried; losing the CLI ends the session. The CLI cannot lower its own score below `oom_score_adj_min` (0) without CAP_SYS_RESOURCE, so the score of everything else has to go up instead.

## Solutions

### Soft reservation and a higher hard limit (R3, R4, R9)

- `src/telegram-container-resource-limits.lib.mjs:13-17`: Docker task defaults are now `DEFAULT_DOCKER_TASK_MEMORY = '60%'`, `DEFAULT_DOCKER_TASK_MEMORY_RESERVATION = '25%'` (and `DEFAULT_DOCKER_TASK_CPU = '50%'` for #3048). The default reservation applies only when `--container-memory` is not set (`:30`), because a reservation that is not below a custom hard limit would make the configuration invalid.
- `src/telegram.config.lib.mjs:101`: new `--container-memory-reservation` / `TELEGRAM_CONTAINER_MEMORY_RESERVATION`.
- `src/container-resource-limits.lib.mjs`:
  - `unlimited` clears any limit, including a default one (`:15-18`);
  - the reservation is validated as a size or percentage and must be below the hard limit (`:71-75`);
  - it is resolved against host RAM like the hard limit (`:106-112`);
  - `buildDockerUpdateArgs` adds `--memory-reservation <bytes>` (`:127-134`).
- The limits are applied by `docker update` while the task is held behind the fail-closed start gate, before its command runs. A failed update keeps the gate closed and reports a launch failure. That covers the first launch, an in-place resume (`src/session-kill-resume.in-place.lib.mjs:92` counts a reservation-only session as limited) and a resume in a new container. The reservation is persisted with the other `containerResourceLimits`, so a restarted bot re-applies it.
- The startup log names the reservation (`src/telegram-container-resource-limits.lib.mjs:39`), and the queue's `Starting:` line shows it per task (#3048).

On the host from the issue a task now gets a 7.0 GiB hard limit with a 2.9 GiB reservation. Up to 7.0 GiB is allowed while the host has free memory. When the host is short of memory, the kernel reclaims first from the tasks that are above their reservation.

### The OOM killer picks the build, not the AI CLI (R6)

`src/tool-shell-oom-score.lib.mjs` (armed once at `src/solve.mjs:8`) sets `BASH_ENV` in solve's environment to a small hook. The AI CLI inherits it, and so does every bash its Bash tool starts:

- Every non-interactive bash (`bash -c`, `bash -lc`) sources `BASH_ENV` before it runs the command. Claude Code, Codex, Gemini, Qwen, OpenCode and Agent run tool commands that way.
- The hook raises the shell's own `/proc/self/oom_score_adj` to 500. That needs no privileges. Builds and tests the shell starts inherit the score, so the OOM killer chooses them over the CLI, which keeps the score it was launched with.
- It skips a shell whose parent is solve itself (`HIVE_MIND_OOM_SCORE_ADJ_LAUNCHER_PID`). That shell is the launcher solve starts the CLI from (command-stream runs `sh -l -c`). If it is bash and raised itself, the CLI would inherit the raised score.
- It only raises a score and never lowers one. It prints nothing. It runs any `BASH_ENV` that was set before it (`HIVE_MIND_PREVIOUS_BASH_ENV`).
- The hook is written to a per-user directory created with mode 0700 (`/tmp/hive-mind-<uid>/`). It is not used when that directory is a symlink, belongs to another user or is writable by others, so no other user can change what every tool shell sources.
- `HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ` changes the score (1–1000), or disables the hook with `off` or `0`. Linux only.

The experiment on this host (Linux 6.8, no privileges) printed:

```
AI CLI       pid 341256: oom_score_adj 0 (badness 668)
tool shell   pid 341274: oom_score_adj 500 (badness 1000)
build        pid 341279: oom_score_adj 500 (badness 1002)
solve        pid 341198: oom_score_adj 0
```

### Documentation

- `docs/DOCKER.md` and its ru, hi and zh translations, "Docker task resource limits":
  - a table of defaults;
  - `unlimited`;
  - the memory, `oom_score_adj` and CPU paragraphs;
  - the `docker update` start gate.

  The stale "no limit is inferred" text was removed.

- `docs/CONFIGURATION.md` and translations: the new defaults, `TELEGRAM_CONTAINER_MEMORY_RESERVATION`, `--container-memory-reservation` and `HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ`.
- `.env.example`: the defaults and the new variables.

## Tests

| Test                                                 | Covers                                                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/issue-3125-memory-reservation.test.mjs` (11)  | Validation, below-the-hard-limit rule, `unlimited`, `docker update` args, defaults, overrides, env, startup log, in-place resume, resume in a new container                       |
| `tests/issue-3125-tool-shell-oom-score.test.mjs` (6) | Score parsing, hook written once and to a private directory, `BASH_ENV` chaining, and a real bash run: tool shells and their children at 500, the CLI and the launcher not raised |
| `tests/test-issue-449-container-resource-limits.mjs` | Existing Docker limit tests, updated for the new defaults                                                                                                                         |

## Remaining limits

- Only bash reads `BASH_ENV`. Commands run through dash (`/bin/sh` on Debian and Ubuntu) or zsh keep score 0. All AI tools supported here use bash for their Bash tool.
- A top-level bash with no `SHLVL` whose stdin is a socket takes bash's "run by sshd" path and reads `~/.bashrc` instead of `BASH_ENV`. solve is started from a shell, so the shells its tools start are nested and read the hook.
- The CLI's own subprocesses that are not shells (for example an MCP server it starts directly) keep score 0.
- The reservation is only reclaimed under host memory pressure. A single task can still reach its 60% hard limit and be OOM-killed. The prompt budget from #2838 and the score above are what make that kill land on a build.
- The first-OOM live report (R5) is part of the #2809 work.

## Upstream

**link-foundation/start: `--memory-reservation` launch flag.** start#236 is merged, but the newest npm release is 0.38.0 (the images pin 0.38.0; this host has 0.37.8). Neither has the flag. The 0.38.0 tarball has no `--memory-reservation` launch option (`src/lib/docker-resource-options.js` knows `--memory`, `--memory-swap`, `--cpus`, `--on-kill-resume-memory`). It only re-applies a reservation it reads back with `docker inspect` on a snapshot `--resume` (`src/lib/docker-resource-limits.js:91`, CHANGELOG entry 9679323). So a reservation set with `docker update` survives start-command's own resume.

- **Repro:** `$ --isolation docker --memory 1g --memory-reservation 512m -- true` prints `Error: Unknown wrapper option: --memory-reservation` (0.37.8, verified on this host). A container started with only `--memory` shows `0` for `docker inspect -f '{{.HostConfig.MemoryReservation}}'`.
- **Workaround (used here):** start the task behind hive-mind's start gate, run `docker update --memory-reservation <bytes> <container>`, then open the gate.
- **Suggested fix:** release start#236. Accept `--memory-reservation <size|N%>` at launch, resolved against daemon capacity like `--memory`. Reject a value at or above `--memory`. List the flag in `$ --help` so callers can detect it, and keep it across `--append-attempt` as it already is across `--resume`.

hive-mind does not need the flag. It is listed only so the launch-time path can replace the `docker update` workaround once it is released.
