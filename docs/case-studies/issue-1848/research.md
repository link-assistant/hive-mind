# Research — temp-directory hygiene and safe cleanup

This document records the background research behind the `cleanup` command
design, with cited sources. It covers three areas: (1) how hive-mind produces
temp artifacts, (2) how the OS already manages `/tmp`, and (3) which existing
libraries/tools solve parts of the problem.

## 1. What hive-mind writes to the temp directory

Derived by reading the source of this repository (not external sources). The
patterns below feed `HIVE_MIND_TEMP_PATTERNS` in `src/cleanup.lib.mjs`:

| Producer (source file)                                 | Temp artifact       | Pattern                                                                   |
| ------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------- |
| `solve.repository.lib.mjs` / `solve.execution.lib.mjs` | per-task git clone  | `gh-issue-solver-<timestamp>`                                             |
| resume flow                                            | resume clone        | `gh-issue-solver-resume-*`                                                |
| `solve.repository.lib.mjs` (`buildWorkspacePath`)      | workspace parent    | `hive-mind-solve-gh-*`                                                    |
| `github.lib.mjs`                                       | log download dir    | `log-tmp-solution-draft-log-*`                                            |
| `claude.lib.mjs`                                       | MCP config          | `claude-mcp-no-useless-*.json` / `claude-mcp-*.json`                      |
| `github.lib.mjs`                                       | comment/body temp   | `solution-draft-log-*.txt`, `log-upload-comment-*.md`, `log-comment-*.md` |
| `github-error-reporter.lib.mjs`                        | issue body temp     | `hive-mind-issue-body-*.md`                                               |
| `solve.auto-pr.lib.mjs` / `solve.results.lib.mjs`      | PR body/title temp  | `pr-body-*`, `pr-title-*.txt`                                             |
| `solve.progress-monitoring.lib.mjs`                    | PR progress temp    | `pr-progress-*`                                                           |
| `telegram-top-command.lib.mjs`                         | top output          | `top-output-*.txt`                                                        |
| `start-screen.mjs`                                     | screen ready marker | `screen-ready-*.marker`                                                   |
| isolation runner (`start-command`)                     | session logs        | `/tmp/start-command/**` (protected)                                       |

The branch-naming convention is defined in `src/solve.branch.lib.mjs`:
`issue-{number}-{hex}` where the hex suffix is `crypto.randomBytes(6)` (12 hex
chars, with an 8-char legacy variant). Reusing `isValidIssueBranchName()` keeps
the cleanup matcher in lock-step with `solve`'s own logic — exactly the "missing
piece" the issue calls out.

The gist log ([`data/free-space-log.txt`](./data/free-space-log.txt)) confirms
the real-world shapes: the running task was a **PR** (`/formal-ai/pull/387`)
whose clone (`/tmp/gh-issue-solver-1780391173130`) was checked out on branch
`issue-386-0f7c7e8a730c`. A PR's head branch is _not_ derivable from the URL
alone, so we resolve it with `gh pr view --json headRefName`; for issue tasks
the `issue-{n}-*` prefix plus a repo match is sufficient.

## 2. How the OS already manages `/tmp` (and why we don't rely on it)

Modern Ubuntu/systemd systems ship `systemd-tmpfiles`, run periodically by the
`systemd-tmpfiles-clean.timer` → `systemd-tmpfiles-clean.service`, which executes
`systemd-tmpfiles --clean`. **By default files in `/tmp` are removed after 10
days and `/var/tmp` after 30 days**, configurable via `Age` rules in
`/etc/tmpfiles.d/`. ([oneuptime](https://oneuptime.com/blog/post/2026-03-02-how-to-configure-systemd-tmpfiles-for-temporary-directory-management-on-ubuntu/view),
[systemd.io](https://systemd.io/TEMPORARY_DIRECTORIES/),
[Baeldung](https://www.baeldung.com/linux/systemd-tmpfiles-configure-temporary-files))

The older `tmpreaper` tool does the same job by age. ([computingforgeeks](https://computingforgeeks.com/automatically-clean-unused-temporary-files-in-linux/))

**Why this is insufficient for our case:**

- The default 10-day window is far too long for a busy solver server that fills
  the disk in hours, as the gist shows (dozens of clones in a single day).
- Age-based deletion is **blind to whether a folder belongs to the running
  task**. A clone created an hour ago for a long-running PR could be older than
  a stale one; age alone can delete the active task or keep junk.
- It cannot distinguish a hive-mind clone from `/tmp/android-sdk` or
  `/tmp/start-command`.

A key systemd safety note we mirror: `systemd-tmpfiles --clean` deliberately
**skips files that are currently open by a process** so it never breaks a
running program ([systemd.io](https://systemd.io/TEMPORARY_DIRECTORIES/)). Our
command implements the same protection by scanning `/proc/<pid>/cwd` and
`/proc/<pid>/fd/*` (`listProcessHeldPaths`) and refusing to delete anything held
open — plus an extra layer that recognises the _task_ a clone belongs to.

**Conclusion:** the OS cleaners are a complementary backstop, not a replacement.
We provide a _task-aware_ cleaner and _also_ expose the OS-level knobs
(`apt-get clean`, `journalctl --vacuum`, `docker system prune`, `npm cache
clean`) behind explicit flags (R7), since those are the "other usual places" the
issue mentions and the gist's `/tmp/apt.log` hints at.

## 3. Deletion library / tooling review

| Option                                                               | Notes                                                                                           | Decision                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fs.rm(path, {recursive:true, force:true})` (built-in, Node ≥ 14.14) | No dependency; sufficient for wiping a directory tree on Linux.                                 | **Chosen** (`removePath`). Repo targets Node ≥ 24, so the built-in is reliable. ([npmjs/rimraf](https://www.npmjs.com/package/rimraf))                                                              |
| `rimraf`                                                             | The cross-platform `rm -rf`; valuable mainly for Windows quirks and `AbortSignal`/glob support. | Not needed — Linux-only target, no globbing required, avoid a dependency. ([npmjs/rimraf](https://www.npmjs.com/package/rimraf), [npm-compare](https://npm-compare.com/del,fs-extra,remove,rimraf)) |
| `del` / `trash`                                                      | `del` adds glob support; `trash` moves to the OS trash (no trash on a headless server).         | Not used; we want a real free-up of disk space.                                                                                                                                                     |
| `du` (coreutils)                                                     | Fast directory sizing identical to the maintainer's manual `du -sh`.                            | **Used** via `getPathSize` with an `fs.statSync` fallback.                                                                                                                                          |
| `screen -ls` / `tmux ls` + `$ --status` (start-command)              | Authoritative source of live isolation sessions and their command lines.                        | **Used** for active-task detection (`listLiveSessionIds`, `listActiveTaskRefsFromSessions`).                                                                                                        |
| `gh pr view --json headRefName`                                      | Resolves a PR's head branch (not in the URL).                                                   | **Used** by `resolvePrHeadBranch`.                                                                                                                                                                  |
| `/proc` scanning                                                     | Linux-native way to know which paths a process holds open / uses as cwd.                        | **Used** (`listProcessHeldPaths`, `listActiveTaskRefsFromProc`).                                                                                                                                    |

## Design principles distilled from the research

1. **Recognition beats age.** Match clones to _tasks_ (branch/repo), not to a
   timestamp.
2. **Never delete in-use paths.** Combine task recognition with `/proc`
   open-file checks — deleting an open file frees nothing and breaks the process
   (the same reason systemd skips open files).
3. **Safe by default.** Default to keeping anything unrecognised; require
   `--all` to be aggressive; require `--force-start-command` for the one path
   whose deletion breaks debugging; confirm before deleting unless `--force`.
4. **Dry-run first.** Show the full keep/delete plan with sizes and reasons so a
   human (or another script) can verify before committing — directly satisfying
   R2.

## Sources

- [How to Configure systemd-tmpfiles for Temporary Directory Management on Ubuntu — OneUptime](https://oneuptime.com/blog/post/2026-03-02-how-to-configure-systemd-tmpfiles-for-temporary-directory-management-on-ubuntu/view)
- [Using /tmp/ and /var/tmp/ Safely — systemd.io](https://systemd.io/TEMPORARY_DIRECTORIES/)
- [Configuration of Temporary Files with systemd-tmpfiles — Baeldung](https://www.baeldung.com/linux/systemd-tmpfiles-configure-temporary-files)
- [Automatically Clean Unused Temporary files in Linux — computingforgeeks](https://computingforgeeks.com/automatically-clean-unused-temporary-files-in-linux/)
- [rimraf — npm](https://www.npmjs.com/package/rimraf)
- [del vs fs-extra vs remove vs rimraf — npm-compare](https://npm-compare.com/del,fs-extra,remove,rimraf)
