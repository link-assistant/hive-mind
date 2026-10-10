# Case study: issue #2888 — fresh-run kill recovery cannot resume Codex threads

- Issue: https://github.com/link-assistant/hive-mind/issues/2888 ([copy](./data/issue-2888.json))
- Pull request: https://github.com/link-assistant/hive-mind/pull/2893
- Affected runs (link-assistant/router, all `/codex` tasks killed at 12:11:39 UTC on 2026-10-09):
  - router#727 → [PR 752](https://github.com/link-assistant/router/pull/752): fresh fallback failed with "no rollout found for thread id" ([session started](https://github.com/link-assistant/router/pull/752#issuecomment-6082862406) ([copy](./data/router-pr-752-session-started-6082862406.md)), [failure](https://github.com/link-assistant/router/pull/752#issuecomment-6082869911) ([copy](./data/router-pr-752-failure-comment-6082869911.md)))
  - router#725 → [PR 750](https://github.com/link-assistant/router/pull/750): fresh fallback refused by the disk preflight (exit 75), still counted as attempt 1/3
  - router#728 → [PR 753](https://github.com/link-assistant/router/pull/753): resumed **in place** and found its thread
  - router#724 → [PR 749](https://github.com/link-assistant/router/pull/749)

## Data in this folder

| File                                             | What it is                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `data/issue-2888.json`                           | The issue (title, body, timestamps)                                                          |
| `data/router-pr-{749,750,752,753}-comments.json` | Every conversation comment of the four affected router pull requests                         |
| `data/router-pr-752-session-started-*.md`        | The "AI Work Session Started" comment of the failing fresh fallback                          |
| `data/router-pr-752-failure-comment-*.md`        | The "🚨 Solution Draft Failed" comment with the full solve log of the failing fresh fallback |

Experiments (all reproducible, outputs committed next to the scripts) live in [`experiments/issue-2888/`](../../../experiments/issue-2888):

| Script                             | Question                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `codex-resume-rollout-location.sh` | Where does `codex exec resume <id>` look, and do a symlinked / copied / re-dated rollout work?     |
| `claude-resume-cross-cwd.sh`       | Does `claude --resume <id>` find a transcript from another working directory?                      |
| `agent-session-storage.sh`         | Where does `agent` keep sessions, and does `--resume` work from a clone / fresh HOME / other repo? |
| `gemini-session-storage.sh`        | The same for `gemini`                                                                              |
| `qwen-session-storage.sh`          | The same for `qwen`                                                                                |
| `opencode-session-storage.sh`      | The same for `opencode`                                                                            |

## Timeline (UTC, 2026-10-09)

| Time        | Event                                                                                                                                                                                                                                                                  | Source                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 06:35–06:38 | Earlier router#727 session on PR 752 ends; auto-restart 1/5. Later the four `/codex` tasks (router#724, #725, #727, #728) run in `$ --isolated docker` containers; each Codex thread's rollout is written to the repository-scoped `CODEX_HOME` _inside_ its container | PR 752 comments, issue           |
| 12:11:39    | The kernel OOM-kills the **host dockerd** (7.3 GB RSS, ~22 concurrent `docker diff`, link-foundation/disk-space-saviour#22). systemd restarts dockerd, which SIGKILLs every container (exit 137), including the root `hive-mind` one                                   | issue                            |
| 13:31       | Root container started again manually; the bot's kill recovery runs for the four tasks                                                                                                                                                                                 | issue                            |
| 14:23:27    | router#727: in-place recovery is not possible, the fresh fallback starts `solve … --tool codex --resume 01a11f62-…` in a **new** container                                                                                                                             | failure log line 1, 7            |
| 14:24:30    | "AI Work Session Started" on PR 752                                                                                                                                                                                                                                    | comment 6082862406               |
| 14:24:5x    | `Warning: Session log for 01a11f62-… not found` → `codex exec resume` → `no rollout found for thread id 01a11f62-… (code -32600)` → `❌ CODEX execution failed`                                                                                                        | comment 6082869911               |
| 14:40:38    | router#728 is resumed **in place** (snapshot of the killed container); `thread.started` shows its thread was found                                                                                                                                                     | PR 753 comment 6083148641, issue |
| 14:41:56    | router#724 recovery session starts                                                                                                                                                                                                                                     | PR 749 comment 6083170342        |
| 14:24–15:49 | router#725 fresh fallback `f648b389-…`: `❌ Insufficient disk space on this host (10215MB available, 10240MB required) — the issue itself was not attempted` (exit 75); attempt 1/3 is spent and nothing starts it again                                               | issue                            |
| 14:50:17    | Issue #2888 filed                                                                                                                                                                                                                                                      | issue                            |
| 15:35:31    | router#727 started again by hand (PR 752)                                                                                                                                                                                                                              | PR 752 comment 6084092410        |
| 15:49:35    | router#725 started again by hand (PR 750)                                                                                                                                                                                                                              | PR 750 comment 6084322795        |
| 16:49:13    | PR 753 auto-merged                                                                                                                                                                                                                                                     | PR 753 comment 6085297947        |
| 19:10:42    | PR 750 auto-merged                                                                                                                                                                                                                                                     | PR 750 comment 6087526490        |
| 22:34:17    | PR 752 auto-merged                                                                                                                                                                                                                                                     | PR 752 comment 6090382591        |
| 10-10 03:25 | PR 749 auto-merged                                                                                                                                                                                                                                                     | PR 749 comment 6093280928        |

All four tasks finished, but two of them only after a human restarted them.

## Requirements

| #   | Requirement (from the issue)                                                                                                                                   | Status                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| R1  | Make the Codex rollout available to the fresh run: `docker cp` it out of the stopped container, or persist the per-repository `CODEX_HOME` on a mounted volume | Done, both                                                                       |
| R2  | If the rollout cannot be recovered, launch without `--resume` (`--auto-continue` on the existing PR)                                                           | Done, for every tool and backend                                                 |
| R3  | A launch refused by the disk preflight (exit 75) must not count as a recovery attempt and must be retried when space frees up                                  | Done                                                                             |
| R4  | Check the same for every tool with `--resume` (claude, agent, gemini, qwen, opencode)                                                                          | Done: experiments per tool, fix covers all of them                               |
| R5  | "A fresh recovery run either has the thread available or does not ask for it"                                                                                  | Done (R1 + R2 + R4)                                                              |
| M1  | Collect the data, reconstruct the timeline, find root causes, research online, check existing components                                                       | This document                                                                    |
| M2  | Add debug/verbose output where the root cause could not be found                                                                                               | `[session-recovery]` log lines and verbose fresh-recovery tracing (below)        |
| M3  | Report problems in other projects upstream, with repro, workaround and fix suggestion                                                                          | All related upstream behaviours were already reported; see [Upstream](#upstream) |
| M4  | Apply the fix everywhere the same problem exists                                                                                                               | Codex in-run resume, fresh recovery (docker and host), disk retry                |

## Root causes

### RC1 — the Codex thread lived only in the killed container (R1)

solve runs Codex with a per-repository `CODEX_HOME` (issue #2074) built by `buildCodexCapabilityStatePath`: `~/.codex/hive-mind/repositories/<owner>/<repo>`. Codex writes every thread to `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<thread id>.jsonl`, and `codex exec resume <id>` searches only there. A Docker task container bind-mounts just `~/.codex/auth.json` and `~/.codex/sessions` (`DOCKER_ISOLATION_TOOL_MOUNTS`, issue #2190) — not the scoped home under `~/.codex/hive-mind/…`. So the only copy of the rollout lived in the container's writable layer and was gone for any new container.

`experiments/issue-2888/codex-resume-rollout-location.sh` (codex-cli 0.161.0) reproduces this exactly:

```
fresh: NOT FOUND (no rollout found)
symlinked: FOUND (thread.started 01a12414-…, then the API call)
copied: FOUND (…)
redated: FOUND (…)          # the YYYY/MM/DD directory does not have to match
prestate: FOUND (…)         # a pre-existing sqlite state db does not hide a restored rollout
```

### RC2 — the fresh fallback always passed `--resume` (R2, R4)

`startKillRecoverySession` launched the fresh run with `plan.command.args`, which always contain `--resume <tool session id>`, without checking that the new run could reach that session. For Codex the run then died within a minute and posted a failure on the pull request. solve's own `--auto-continue` (on by default) would have picked the existing pull request up.

### RC3 — tool session stores are per container and often per directory (R4)

Experiments with each tool (versions as installed on 2026-10-10):

| tool (version)   | store read by `--resume`                                                             | found from another directory?                                                                | fresh HOME (= new container) | relocate with                   | mounted into task containers?  |
| ---------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------- | ------------------------------ |
| claude           | `~/.claude/projects/<cwd slug>/<id>.jsonl`                                           | **yes**, by id                                                                               | not found                    | `CLAUDE_CONFIG_DIR`             | yes                            |
| codex 0.161.0    | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`                               | **yes**, by id                                                                               | `no rollout found`           | `CODEX_HOME`                    | `~/.codex/sessions` only → RC1 |
| agent 0.26.11    | `~/.local/share/link-assistant-agent/storage/session/<root commit>/ses_*.json`       | same repository (root commit) only                                                           | `SessionNotFound`            | `XDG_DATA_HOME`                 | no                             |
| gemini 0.63.0    | `~/.gemini/tmp/<slug of the cwd basename>/chats/session-*.jsonl` + `projects.json`   | **no** — "No previous sessions found for this project"                                       | not found                    | `GEMINI_CLI_HOME`               | no                             |
| qwen 0.25.0      | `~/.qwen/projects/<sanitized cwd>/chats/<id>.jsonl`, first record's `cwd` is checked | **no** — "No saved session found with ID …"                                                  | not found                    | `QWEN_HOME`, `QWEN_RUNTIME_DIR` | no                             |
| opencode 1.18.35 | SQLite `~/.local/share/opencode/opencode.db`; the session row keeps its `directory`  | found by id, but tools **run in the old directory**; "Unexpected server error" if it is gone | `Session not found`          | `OPENCODE_DB`, `XDG_DATA_HOME`  | no                             |

A fresh solve run always works in a new temporary directory (`/tmp/gh-issue-solver-resume-<id>-<ts>`, `solve.repository.lib.mjs`). So for gemini, qwen and opencode a fresh run with `--resume` cannot work even on a screen/tmux host that keeps the tool's store — and opencode would edit files in the _old_ checkout if it still exists.

What would make each one resumable (all verified in the experiments): mount/copy the store; for gemini also copy the chat into the new cwd's slug; for qwen also rewrite the recorded `cwd`; for opencode rewrite `session.directory` or `opencode export` + `opencode import` from the new directory. These are tool-internal formats, so hive-mind does not depend on them; it drops `--resume` instead and relies on `--auto-continue`.

### RC4 — a refused launch was counted as an attempt and never retried (R3)

solve exits with 75 (`EXIT_CODE_INSUFFICIENT_DISK_SPACE`) when the host has less free disk than `--min-disk-space` (default 10240 MB): "the issue itself was not attempted". 75 is `EX_TEMPFAIL` in `sysexits.h` — "temporary failure; the user is invited to retry". The session monitor only ran kill recovery for _killed_ sessions (`shouldAttemptKillRecovery`), so a recovery session that exited 75 was treated as an ordinary failure: `killRecoveryAttempts` had already been incremented when it was launched, and nothing ever started it again. router#725 was 25 MB short.

## Solutions (implemented in PR #2893)

### S1 — persist Codex rollouts on the mounted volume (RC1, R1)

[`src/codex-sessions.lib.mjs`](../../../src/codex-sessions.lib.mjs): `prepareScopedCodexHome` (`codex-capability-preflight.lib.mjs`) makes `<scoped CODEX_HOME>/sessions` a relative symlink to `~/.codex/sessions`. Every rollout therefore lands on the mounted volume while each repository keeps its own config, plugins and state databases. An existing real `sessions` directory is merged into the shared one first; anything that could not be moved is kept aside as `sessions.pre-issue-2888-<ts>`, so rollouts written before the upgrade are never lost.

### S2 — restore a rollout from the stopped container (RC1, R1)

[`restoreCodexRolloutFromContainer`](../../../src/session-kill-resume.fresh-session.lib.mjs) runs `docker cp <killed container>:<scoped CODEX_HOME>/sessions/. <staging>` (`copyFromDockerContainer` in `isolation-runner.lib.mjs`). docker cp works on stopped containers. It then copies the thread's rollout into the host's `~/.codex/sessions`, which the new container mounts. This covers tasks that were started before S1.

### S3 — the fresh run resumes only what it can reach (RC2, RC3, R2, R4)

[`resolveFreshRecoveryCommand`](../../../src/session-kill-resume.fresh-session.lib.mjs) decides, per tool and backend, whether `--resume` stays:

| backend      | tool                          | decision                                                                                      |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| docker       | claude                        | keep if the transcript is under the mounted `~/.claude/projects`, else drop                   |
| docker       | codex                         | keep if the rollout is under the mounted `~/.codex/sessions`, else restore it (S2), else drop |
| docker       | agent, gemini, qwen, opencode | drop (`tool-session-not-persisted`)                                                           |
| docker       | any, with `--use-router`      | drop: router tasks mount no vendor state                                                      |
| screen, tmux | gemini, qwen, opencode        | drop (`tool-session-cwd-bound`) unless the command pins `--working-directory`                 |
| screen, tmux | claude, codex, agent          | keep                                                                                          |

Without `--resume`, `--auto-continue` picks up the existing pull request. The decision and its reason are returned as `freshResume` and logged as a `[session-recovery]` line whenever `--resume` is dropped.

The same guard exists inside solve: when `codex exec resume` is asked for a thread whose rollout is not under `CODEX_HOME/sessions` (an externally supplied `--resume`), `codex.lib.mjs` starts a new thread instead of failing (checked once per run).

### S4 — a disk-refused recovery does not spend an attempt (RC4, R3)

[`src/session-kill-resume.disk-retry.lib.mjs`](../../../src/session-kill-resume.disk-retry.lib.mjs): when a recovery session (`killRecoveryResumed`) exits 75, the monitor relaunches it with the **same** attempt number. The wait before the relaunch polls free space on `/tmp` every 30 s and ends as soon as `--min-disk-space` is free. A refused fresh run left nothing behind, so it is relaunched fresh. The number of disk-refused relaunches per attempt is bounded and stored in `killRecoveryDiskDeferrals` (persisted), so a host that never frees space cannot loop. A first run that exits 75 is not affected, and neither is `--on-session-kill report` or `/stop`.

| variable                                  | default | meaning                                              |
| ----------------------------------------- | ------- | ---------------------------------------------------- |
| `HIVE_MIND_SESSION_KILL_DISK_RETRIES`     | 6       | disk-refused relaunches per attempt (0 turns it off) |
| `HIVE_MIND_SESSION_KILL_DISK_RETRY_DELAY` | 300     | longest wait before a relaunch, in seconds           |
| `HIVE_MIND_SESSION_KILL_DISK_RETRY_PATH`  | `/tmp`  | filesystem polled for free space                     |

The Telegram notice says "That does not count as a recovery attempt" (en, ru, zh, hi).

### Debug output (M2)

- `[session-recovery]` log lines for every disk-refused relaunch decision, including free/required MB and the path polled.
- `--verbose` traces the fresh-recovery decision (`[VERBOSE] Fresh recovery for <container>: …`), including what docker cp restored.
- `startKillRecoverySession` returns `freshResume: {keptResume, reason, resumeId, restoredFrom}`; a `[session-recovery]` line names the reason and the final command whenever `--resume` is dropped (always with `--verbose`).

### Tests

- [`tests/issue-2888-fresh-recovery-resume.test.mjs`](../../../tests/issue-2888-fresh-recovery-resume.test.mjs): rollout lookup, the sessions symlink and merge, docker cp restore, per-tool and per-backend `--resume` decisions, router tasks, and the launched command.
- [`tests/issue-2888-disk-refused-recovery.test.mjs`](../../../tests/issue-2888-disk-refused-recovery.test.mjs): exit-75 detection, the relaunch plan (same attempt, bounded, policy, `/stop`), the disk-space wait, the router#725 reproduction, and monitor-level relaunches.

## Alternatives considered

- **Mount the whole `~/.codex` into task containers.** It would also share config, plugins and the per-repository state databases between concurrent tasks — exactly what the scoped home (#2074) avoids. Rejected in favour of sharing only `sessions`.
- **Mount the data directories of agent, gemini, qwen and opencode.** It would not be enough on its own: gemini, qwen and opencode bind a session to its directory, and a fresh run's directory is new every time. Sharing agent's store across containers also exposes it to agent's project `prune()` of sessions whose worktree path no longer exists (from reading its source; not reproduced). A possible follow-up, not required for "either available or not asked for".
- **Rewrite tool-internal session files** (qwen `cwd`, opencode `session.directory`, gemini slug). Works in the experiments, but couples hive-mind to undocumented formats that already changed between versions (gemini moved from sha256 directories to slugs).
- **Retry exit 75 as a new attempt.** That is what spent router#725's attempt; the attempt budget is meant for sessions that actually ran.

## Existing components and online research

- Codex stores sessions as `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and resumes them with `codex resume` / `codex exec resume <id>` (`--last`, `--all`): [Codex CLI session lifecycle](https://codex.danielvaughan.com/2026/04/11/codex-cli-session-lifecycle-resume-fork-rollouts), [session management](https://codex.danielvaughan.com/2026/04/13/codex-cli-session-management-resume-fork-transcripts), [How to resume sessions](https://inventivehq.com/knowledge-base/openai/how-to-resume-sessions), [Codex session JSONL disk space](https://aident.ai/blog/fix-codex-session-jsonl-disk-space). In the Codex source the directory is the constant `SESSIONS_SUBDIR = "sessions"` under `CODEX_HOME` (`codex-rs/rollout/src/lib.rs`).
- `docker cp` copies from running _or stopped_ containers and behaves like `cp -a`: [docker container cp reference](https://docs.docker.com/reference/cli/docker/container/cp/), [Copy file from stopped container](https://slides.code-maven.com/docker/copy-file-from-stopped-container.html).
- Exit status 75 is `EX_TEMPFAIL` ("temporary failure, indicating something that is not really an error … the user is invited to retry"): [sysexits.h (bionic)](https://android.googlesource.com/platform/bionic/+/f294d87/libc/include/sysexits.h), [sysexits.h (4.3BSD)](https://stuff.mit.edu/afs/athena/astaff/reference/4.3network2/include/sysexits.h).
- Gemini CLI: "Sessions are project-specific" and stored under `~/.gemini/tmp/<project>/chats/` ([session management](https://geminicli.com/docs/cli/session-management/)). opencode data directory: [troubleshooting](https://opencode.ai/docs/troubleshooting/).
- start-command (`$ --isolated docker`) already provides what was needed: per-task volume mounts and the stopped container itself for `docker cp`. No new dependency is needed.

## Upstream

No other project caused this incident: the missing mount and the unconditional `--resume` were in hive-mind, and both are fixed here. The cross-directory resume limits found while checking R4 are already reported upstream, so no duplicates were filed:

| project  | behaviour seen in the experiments                                                   | existing upstream report                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| qwen     | an explicit `--resume <id>` is not found after the project directory changes        | [QwenLM/qwen-code#12553](https://github.com/QwenLM/qwen-code/issues/12553), fix in [#12592](https://github.com/QwenLM/qwen-code/pull/12592)       |
| opencode | the session keeps its absolute directory; if it is gone → "Unexpected server error" | [anomalyco/opencode#49476](https://github.com/anomalyco/opencode/issues/49476), fix in [#52106](https://github.com/anomalyco/opencode/pull/52106) |
| opencode | `run --session <id>` with another directory hangs after the turn                    | [anomalyco/opencode#41841](https://github.com/anomalyco/opencode/issues/41841) (also seen in step 2 of our experiment)                            |
| gemini   | sessions are listed and resumed per project only                                    | [google-gemini/gemini-cli#28595](https://github.com/google-gemini/gemini-cli/issues/28595) (cross-workspace session listing)                      |
| codex    | `resume <id>` searches only `$CODEX_HOME/sessions`                                  | by design; `CODEX_HOME` relocates it, which S1 uses                                                                                               |

The host dockerd OOM that started the incident is tracked in [link-foundation/disk-space-saviour#22](https://github.com/link-foundation/disk-space-saviour/issues/22).
