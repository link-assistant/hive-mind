# Case study: kill recovery ran the Telegram alias as the program (issue #2887)

- Issue: https://github.com/link-assistant/hive-mind/issues/2887 (duplicate report of the same root cause: #2630)
- Pull request: https://github.com/link-assistant/hive-mind/pull/2895
- Date of incident: 2026-10-09 (hive-mind 2.34.0, start-command 0.35.4). Date of fix: 2026-10-10 (base: hive-mind 2.35.2, start-command 0.36.0)

Files in this folder:

- [`online-research.md`](./online-research.md): shell exit status semantics, `sh -c` quoting, `docker commit`, Docker exit 137 / `OOMKilled`, with sources.
- [`data/issue-2887.json`](./data/issue-2887.json): the issue text as filed (`gh issue view 2887 --json …`).
- [`data/alias-as-binary-experiment.txt`](./data/alias-as-binary-experiment.txt): output of [`experiments/issue-2887/alias-as-binary.mjs`](../../../experiments/issue-2887/alias-as-binary.mjs), which runs both command forms through `sh -c` exactly as start-command does.

## 1. Problem

A task started from Telegram with an alias (`/codex <url>`, `/claude <url>`, `/agent <url>` …) is stored with `sessionInfo.command = 'solve'`, `sessionInfo.commandAlias = 'codex'` and args that already contain `--tool codex` (issue #2109). When such a task was killed, the built-in kill recovery resumed it **in place** with start-command:

```
$ --resume <execution uuid> --output-format json -- <command>
```

start-command commits the killed container (`docker commit`, 10–35 min and 11–24 GB in the incident) and starts `<session>-resume-N` with `["sh","-c","<command>"]`. hive-mind passed the _chat_ spelling of the command, `/codex https://… --resume <thread>`, so every recovered alias task died one second later:

```
sh: 1: /codex: not found          # exit 127
```

The bot then printed `oom-killed` (exit 137) for the session and removed it from tracking. The task was never resumed.

## 2. Timeline (UTC)

| Time                | Event                                                                                                                                                                                                                                                                                                                 | Source        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 2026-10-07 09:07    | Earlier occurrence: `/claude …/hive-mind/issues/2591` task OOM-killed; at 09:54 its in-place recovery ran `sh -c "/claude … --resume 41cebf9b-…"` → `sh: 1: /claude: not found`, exit 127, no further attempt. Filed as #2630 (hive-mind 2.33.11, start-command 0.35.1).                                              | #2630         |
| 2026-10-09 12:11:39 | Kernel OOM-kills the **host** dockerd (7.3 GB RSS from ~22 concurrent `docker diff` calls, link-foundation/disk-space-saviour#22). systemd restarts dockerd; with live-restore off (#2900) every container is SIGKILLed (137): the root `hive-mind` container and four `/codex` tasks (router#724, #725, #727, #728). | issue #2887   |
| 2026-10-09 13:31    | Root container started again by hand. The bot's monitor sees the four sessions as killed and runs kill recovery for each.                                                                                                                                                                                             | issue #2887   |
| 13:31 – ~14:10      | For each session start-command runs `docker commit` of the dead container (10–35 min, 11–24 GB each; concurrent commits — #2889).                                                                                                                                                                                     | issue #2887   |
| after commit        | `eec34a2b-…-resume-1` (router#728) and `9243e682-…-resume-1` (router#724) start `sh -c "/codex … --resume <thread>"` → `sh: 1: /codex: not found`, exit 127.                                                                                                                                                          | `docker logs` |
| after exit          | Bot log: `EVENT session_completion_notified {"sessionName":"eec34a2b-…","exitCode":137,"status":"oom-killed"}`, then `Session eec34a2b-… removed from tracking (exit: 137, status: oom-killed)`. No further recovery.                                                                                                 | bot log       |
| 2026-10-09 (manual) | Workaround verified: `$ --resume deb9c2e9-… -- solve …/router/issues/728 … --resume 01a1200a-…` → `…-resume-1-resume-2` starts and Codex resumes thread `01a1200a-…`.                                                                                                                                                 | issue #2887   |
| 2026-10-09 14:50    | Issue #2887 filed together with #2888, #2889, #2890; #2900 at 15:18.                                                                                                                                                                                                                                                  | GitHub        |

## 3. Requirements from the issue

| #   | Requirement                                                                                                               | Where it is handled                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `buildResumeCommand` gives separate `display` (alias) and executable forms.                                               | `src/session-resume.lib.mjs` — returns `{ binary, args, display, shell }`; `binary`/`shell` always use the real program (`solve`), `display` keeps `/codex` for chat text.                                                                          |
| R2  | Use the executable form everywhere a command is run (`$ --resume`, `executeWithIsolation`, any `recoveryCommand`).        | In-place: `resumeKilledSessionInPlace` passes `plan.command.shell`. Fresh run: `executeWithIsolation(sessionInfo.command \|\| 'solve', plan.command.args)` (already correct). PR recovery notice (`buildKillRecoveryNotice`) shows `shell`. See §6. |
| R3  | Test that the in-place resume command never starts with `/`.                                                              | `tests/test-issue-2887-resume-executable.mjs` §1, §3; runtime guard `isRunnableShellCommand` (skip reason `no-runnable-command`).                                                                                                                   |
| R4  | Classify a resumed container's exit from its own exit code (127 → "command not found", not `oom-killed`).                 | `describeCommandStartFailure` in `src/session-status.lib.mjs`; completion text in `src/work-session-formatting.lib.mjs`; `resolveOomKilledState` already lets an ordinary exit < 128 win over a sticky `OOMKilled` (tested in §5).                  |
| R5  | Keep tracking/recovering instead of dropping the session.                                                                 | `detectFailedRecoveryStart` + monitor: a 126/127 exit of an in-place recovery starts a fresh-run recovery with the tool's `--resume` id; the failed attempt is refunded.                                                                            |
| R6  | Collect logs/data, deep case study: timeline, requirements, root causes, solutions, existing components, online research. | This folder.                                                                                                                                                                                                                                        |
| R7  | Add debug/verbose output where data is missing.                                                                           | `[VERBOSE] In-place resume of <session>: $ --resume <id> -- <shell>`; warning on `no-runnable-command`; `EVENT session_kill_recovery_start_failed`; persisted `killRecoveryCommand` and `killRecoveryStartFailure`.                                 |
| R8  | Report issues to other repositories where needed.                                                                         | Not needed — see §8.                                                                                                                                                                                                                                |
| R9  | Apply the fix to the entire codebase.                                                                                     | Every consumer of `buildResumeCommand` was audited — see §6.                                                                                                                                                                                        |

## 4. Root causes

### RC1 — the chat alias was used as the binary

On the incident commit [`790c18de`](https://github.com/link-assistant/hive-mind/blob/790c18dec9ec0dd2281de05a48f2047690a60415/src/session-resume.lib.mjs#L256-L274):

```js
const bin = binary || (commandAlias ? `/${commandAlias}` : command);
return { binary: bin, args, display: `${bin} ${args.map(quoteArg).join(' ')}` };
```

`/${commandAlias}` was added for #2109 so the "♻️ Resume from last session" Telegram message can be copied back into the chat. It became both `binary` and `display`; there was no executable form at all.

### RC2 — the in-place path executed the chat text

[`session-kill-resume.in-place.lib.mjs#L197`](https://github.com/link-assistant/hive-mind/blob/790c18dec9ec0dd2281de05a48f2047690a60415/src/session-kill-resume.in-place.lib.mjs#L197):

```js
const result = await runner.resumeIsolatedSession(decision.identifier, { command: plan?.command?.display || null, verbose });
```

start-command runs that string with `sh -c`, so the first word `/codex` is looked up as an absolute path and does not exist → POSIX exit 127 ([online research](./online-research.md#1-exit-status-126-and-127)). Reproduced in [`data/alias-as-binary-experiment.txt`](./data/alias-as-binary-experiment.txt):

```
display: sh -c "/codex https://github.com/link-assistant/router/issues/728 --tool codex … --resume 01a1200a-…"
  stderr: sh: 1: /codex: not found
  exit 127
```

`display` also used the human-oriented `quoteArg` (double quotes), so even with `solve` as the first word, an argument containing `$`, `` ` `` or `\` would have been expanded by `sh`. The new `shell` form uses POSIX single-quote escaping (`shellQuoteArg`); the experiment passes `"it's $HOME"` through unchanged.

Sessions started with `/solve` were not affected (`/solve` → `command='solve'`, no alias), which is why the bug survived #2189/#2408 tests: their fixtures had no `commandAlias`.

### RC3 — a recovery that cannot start was treated as an ordinary failure

The monitor ran kill recovery only when the kill report said the container was killed (`killReport.killed || killReport.oomEventOnly` in `src/session-monitor.lib.mjs`). Exit 127 is `failed`, so the `-resume-1` session ended as an ordinary failure: no new attempt, and no hint that the _recovery_ had broken. Its completion message said only "failed (exit 127)".

### About the `oom-killed` line in the bot log (remaining uncertainty)

The logged event names `eec34a2b-…` — the **original** session, not `eec34a2b-…-resume-1`. Kill recovery runs inside the original session's completion handler, before its Telegram completion message, so `exitCode 137 / oom-killed` describes the original container (killed when dockerd restarted with Docker's sticky `OOMKilled=true`). That is correct for that container. The recovery session's own completion (exit 127) did not reach the attached log excerpt. The code already scopes the log footer to the recovery (`scopeRecoveryFooter`, #2498) and lets an exit < 128 win over a sticky `OOMKilled` (`resolveOomKilledState`), and the new test §5 checks that a recovery session with `oomKilled: true` and exit 127 is reported as `failed`/127 with "command not found". The bot log is not enough to prove that no other path printed 137 for the resume container; the new `session_kill_recovery_start_failed` event and the persisted `killRecoveryCommand` will show it directly if it ever happens again.

## 5. Solution

| Change                                                                                                                                                                                                                                                | File                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `shellQuoteArg` (POSIX single-quote quoting) and `buildResumeCommand` returning `{ binary: 'solve', args, display: '/codex …', shell: "solve … --resume <id>" }`.                                                                                     | `src/session-resume.lib.mjs`                                       |
| `isRunnableShellCommand`: refuses an empty command or one whose first word is a Telegram command (`/[a-z0-9_-]+`); `/usr/local/bin/solve` stays runnable.                                                                                             | `src/session-resume.lib.mjs`                                       |
| In-place resume passes `plan.command.shell`; a non-runnable command is skipped with `no-runnable-command` (the fresh-run fallback then runs), with a warning and a verbose line showing the exact command.                                            | `src/session-kill-resume.in-place.lib.mjs`                         |
| `describeCommandStartFailure(126/127)` and `COMMAND_NOT_FOUND_EXIT_CODE`/`COMMAND_NOT_EXECUTABLE_EXIT_CODE`.                                                                                                                                          | `src/session-status.lib.mjs`                                       |
| Completion text: "failed (exit 127): command not found — the program the session was asked to run does not exist" (en, ru, zh, hi).                                                                                                                   | `src/work-session-formatting.lib.mjs`, `src/locales/*`             |
| `detectFailedRecoveryStart`: an in-place recovery that exits 126/127 (not stopped by the user) is a failed recovery start. The monitor logs `session_kill_recovery_start_failed` and runs recovery again.                                             | `src/session-kill-resume.lib.mjs`, `src/session-monitor.lib.mjs`   |
| The retry skips in-place (`previous-in-place-command-not-found`), refunds the failed attempt, takes the tool session id from the failed command's `--resume`, and keeps `rootSessionName`. A fresh run that exits 127 is not retried again (no loop). | `src/session-kill-resume.lib.mjs`                                  |
| `killRecoveryCommand` (what was executed) and `killRecoveryStartFailure` persisted with the session.                                                                                                                                                  | `src/session-kill-resume.lib.mjs`, `src/session-store.lib.mjs`     |
| PR recovery notice "Manual resume" block shows the runnable `shell` form.                                                                                                                                                                             | `src/session-kill-recovery.lib.mjs`, `src/session-monitor.lib.mjs` |

### Tests

- `tests/test-issue-2887-resume-executable.mjs` (68 assertions):
  1. For aliases `codex`, `claude`, `solve`, `agent`, `opencode` and none: `binary` is `solve`, `shell` never starts with `/`, `display` keeps the alias.
  2. `shell` round-trips through real `sh -c` with hostile args (`'`, `$HOME`, `` `id` ``, `$(y)`, spaces, double quotes, backslash, empty string).
  3. `recoverKilledSession` for an alias task passes `plan.command.shell` to `resumeIsolatedSession`; a plan with only `display` or with an alias as the first word is skipped (`no-runnable-command`) without calling start-command.
  4. The PR notice uses `solve …`, never `/codex …`.
  5. 126/127 descriptions; completion message for a recovery session with sticky `oomKilled` and exit 127 says "command not found" and not "oom".
  6. `detectFailedRecoveryStart` and the fresh retry described above.
- Updated fixtures in `test-issue-2189-same-container-resume.mjs`, `test-issue-2408-limited-in-place-resume.mjs`, `issue-2498-recovery-lifecycle.test.mjs` (plans now carry `shell`, and #2189 asserts the shell form is what runs).
- The new test fails on the base commit (no `shell`, no `detectFailedRecoveryStart`).

## 6. Whole-codebase audit (R9)

| Consumer of a resume / recovery command                          | Form used after the fix      | Runs it?      |
| ---------------------------------------------------------------- | ---------------------------- | ------------- |
| `resumeKilledSessionInPlace` → `$ --resume … -- <command>`       | `shell`                      | yes           |
| `startKillRecoverySession` fresh run → `executeWithIsolation`    | `sessionInfo.command` + args | yes           |
| `buildKillRecoveryNotice` "Manual resume" (PR/issue comment)     | `shell`                      | user          |
| `formatResumeSection` / "♻️ Resume from last session" (Telegram) | `display` (alias, intended)  | user, in chat |
| `recoverKilledSession` result field `display` (informational)    | `display`                    | no            |

`grep -rn '\.display\b' src` finds no other place that executes the display string.

## 7. Existing components and alternatives considered

- **start-command** (`$`, link-foundation/start) owns `--resume` and runs the command with `sh -c`. `resumeIsolatedSession` (`src/isolation-runner.resume.lib.mjs`) passes the command as one argument after `--`, and start-command runs a lone argument through `sh -c`, so the string itself must be valid shell; that is what the new `shell` form guarantees. A POSIX single-quote quoter (as in [`shell-quote`](https://www.npmjs.com/package/shell-quote) / Python `shlex.quote`) is ~5 lines, so no dependency was added.
- `command -v <first word>` inside the image before `$ --resume` (suggested in #2630) would need an extra container start after a 10–35 minute commit; the static `isRunnableShellCommand` guard plus the 127 → fresh-run fallback cover the same failure without that cost.
- Cleaning up the leaked `start-command-resume/<uuid>:<n>` image and stopped `-resume-N` container after a failed resume (#2630 point 4) belongs to `hive-cleanup` and is tracked in #2629.

## 8. Upstream reports (R8)

No upstream issue was filed. start-command behaved as documented: it ran the command it was given and reported exit 127. The lock-timeout problem seen in earlier resumes (link-foundation/start#193) is already fixed in start-command 0.36.0, which `Dockerfile` and `Dockerfile.dind` pin on `main`. The other problems of the same incident are hive-mind issues already filed: #2888 (CODEX_HOME not mounted for fresh-run recovery), #2889 (concurrent `docker commit`), #2890 (persisting queue/recovery state), #2900 (Docker live-restore), #2629 (cleanup of resume artefacts).

## 9. How to reproduce

```
node experiments/issue-2887/alias-as-binary.mjs                # display → exit 127, shell → argv intact
node tests/test-issue-2887-resume-executable.mjs                # regression test
```

Real-world reproduction (from the issue): `/codex https://github.com/<owner>/<repo>/issues/<n>` with docker isolation, `docker kill <task container>` while the tool runs, wait for kill recovery. Before the fix `<name>-resume-1` exits 127 with `sh: 1: /codex: not found`; after it the container runs `solve … --resume <thread id>`.
