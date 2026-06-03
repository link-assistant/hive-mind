---
'@link-assistant/hive-mind': minor
---

feat(cleanup): add a task-aware `cleanup` command to free disk space safely (#1848)

Adds a new `cleanup` bin that removes stale hive-mind temporary
directories/files under the system temp dir while preserving folders that belong
to currently-running tasks, protected system paths, and any clone with
uncommitted or unpushed work.

Highlights:

- `--dry-run` / `-n` prints the full list of kept folders and folders that would
  be deleted (with sizes and reasons), deleting nothing.
- `--keep-active-tasks-folders` (default on) detects active tasks from running
  processes (`/proc`) and live isolation sessions (`screen`/`tmux` +
  `$ --status`), and matches clones to tasks by branch name using the same logic
  as `solve` (issue → `issue-{n}-{hex}` scoped to the repo; PR → its resolved
  head branch). Disable with `--no-keep-active-tasks-folders`.
- Keeps `/tmp/start-command/` and system-owned temp entries by default;
  `--force-start-command` allows deleting `/tmp/start-command` when needed.
- Optional Ubuntu/system cleanup behind explicit flags: `--apt`, `--journal`,
  `--docker`, `--npm` (and `--system` shorthand), with `--sudo`.
- Safe by default: keeps unrecognised entries unless `--all`, never deletes
  paths held open by a running process or used by the cleanup process itself,
  and requires confirmation unless `--force`.
