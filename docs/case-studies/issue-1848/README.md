# Case Study — Issue #1848: Add a `cleanup` command

> **Issue:** [Add `cleanup` command, with `--keep-active-tasks-folders` and `--dry-run` modes](https://github.com/link-assistant/hive-mind/issues/1848)
> **Branch:** `issue-1848-6e6905b2e594` · **PR:** [#1849](https://github.com/link-assistant/hive-mind/pull/1849)

This folder contains the deep case-study analysis requested in the issue:

| File                                                   | Contents                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [`README.md`](./README.md)                             | Problem statement and the full, enumerated requirement list.                                                          |
| [`research.md`](./research.md)                         | Background research with cited online sources (temp-dir lifecycle, OS cleanup tooling, deletion libraries).           |
| [`solution-plan.md`](./solution-plan.md)               | Per-requirement solution proposals, the chosen approach, existing-component/library review, and the resulting design. |
| [`data/free-space-log.txt`](./data/free-space-log.txt) | The maintainer's original terminal session (from the gist) that motivated this command.                               |
| [`data/issue-1848.json`](./data/issue-1848.json)       | Snapshot of the issue metadata.                                                                                       |

## Problem statement

The hive-mind toolchain (`solve`, `hive`, `task`, the Telegram bot, the
isolation runner, …) produces a large volume of temporary artifacts under the
system temp directory (usually `/tmp`):

- one git **clone per task** (`/tmp/gh-issue-solver-<timestamp>`),
- per-run **MCP config** files (`/tmp/claude-mcp-no-useless-*.json`),
- **log download** working directories (`/tmp/log-tmp-solution-draft-log-*`),
- PR body/title/progress temp files, screen-ready markers, etc.

On a long-running server these accumulate until the disk fills up. The
maintainer's recorded workaround ([`data/free-space-log.txt`](./data/free-space-log.txt))
was to manually:

1. list the live session (`screen -ls`),
2. `du -sh /tmp/*` to see what is using space,
3. inspect each clone's git remote/branch (`git remote -v`, `git status`),
4. confirm which clone belonged to the **single running task**
   (`solve …/formal-ai/pull/387` → branch `issue-386-0f7c7e8a730c` in
   `/tmp/gh-issue-solver-1780391173130`),
5. `rm -rf` everything else (other clones, `android-sdk`, `flutter`, log dirs),
6. and finally re-check `$ --status <uuid>` to confirm the running task was
   untouched.

This is error-prone (one wrong `rm -rf` deletes the active task or
`/tmp/start-command`, breaking the whole server) and tedious. The issue asks for
this to be turned into a **safe, automated `cleanup` command**.

## Enumerated requirements

Each requirement is quoted/derived from the issue body and tracked to its
implementation. See [`solution-plan.md`](./solution-plan.md) for the design of
each.

| #       | Requirement (from the issue)                                                                                                                                                                                                                          | Where addressed                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | Provide a standalone **`cleanup` command**.                                                                                                                                                                                                           | `src/cleanup.mjs`, `bin.cleanup` in `package.json`                                                                                                      |
| **R2**  | A **`--dry-run`** mode that shows "the list of kept folders, and the list of deleted folders" and deletes nothing.                                                                                                                                    | `--dry-run` / `-n`; KEPT + WOULD DELETE report                                                                                                          |
| **R3**  | A **`--keep-active-tasks-folders`** mode: keep folders that match currently-running tasks. _"The missing piece is to get the branch name of issue/pull request as per our solve command logic, to understand which folders do match existing tasks."_ | active-task detection: `getActiveTasks`, `buildActiveMatchers`, `folderMatchesActiveTask`; on by default, disable with `--no-keep-active-tasks-folders` |
| **R4**  | Derive the **branch name the same way `solve` does**, to match clones to tasks (issue → `issue-{n}-{hex}`; PR → its head branch).                                                                                                                     | `isValidIssueBranchName` reuse + `resolvePrHeadBranch` (`gh pr view`)                                                                                   |
| **R5**  | Keep **`/tmp/start-command/` and other places** that would interfere with the system working / being debugged.                                                                                                                                        | `DEFAULT_PROTECTED_NAMES`, `SYSTEM_PROTECTED_PATTERNS`                                                                                                  |
| **R6**  | _"Make sure we fully configure everything, with ability to **force deletion of `/tmp/start-command`** if needed."_                                                                                                                                    | `--force-start-command`                                                                                                                                 |
| **R7**  | Also perform **cleanup for apt install and other usual places on Ubuntu**.                                                                                                                                                                            | `--apt --journal --docker --npm` / `--system`, `runSystemCleanup`                                                                                       |
| **R8**  | Be **safe** — never break the running server (the original motivation).                                                                                                                                                                               | dry-run-friendly defaults, confirmation prompt, self-path + process-held (`/proc`) protection, dirty-worktree protection                                |
| **R9**  | Collect issue data into **`./docs/case-studies/issue-1848/`** and do deep analysis: research online, list every requirement, propose solutions/plans, and review existing components/libraries.                                                       | this folder                                                                                                                                             |
| **R10** | Reproducible **tests**.                                                                                                                                                                                                                               | `tests/test-cleanup-1848.mjs`                                                                                                                           |
| **R11** | Do everything in **a single pull request** (#1849).                                                                                                                                                                                                   | branch `issue-1848-6e6905b2e594`                                                                                                                        |

## How the command satisfies the original workflow

The command reproduces every manual step above automatically and safely:

| Manual step                                             | Automated by                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `screen -ls` to find live sessions                      | `listLiveSessionIds()` (screen + tmux)                              |
| `$ --status <uuid>` to read the running command         | `listActiveTaskRefsFromSessions()` via isolation-runner             |
| `du -sh /tmp/*`                                         | `listTempEntries()` + `getPathSize()` (reported sorted by size)     |
| `git remote -v` / `git status` per clone                | `readFolderGitInfo()`                                               |
| deciding which clone is the active task                 | `folderMatchesActiveTask()` (branch / `issue-{n}` + repo)           |
| `rm -rf` everything else                                | classification → `removePath()` (guarded by dry-run + confirmation) |
| not touching `/tmp/start-command`, `.X11-unix`, sockets | protected-name / system-pattern keep rules                          |
| not touching the clone you're standing in               | self-path + `/proc/<pid>/cwd` "active-process" keep rule            |
