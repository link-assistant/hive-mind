# Solution plan — per requirement

For each requirement (R1–R11 from [`README.md`](./README.md)) this lists the
options considered, the chosen approach, and the resulting implementation.

## Architecture overview

The command is split into three modules so the decision logic can be unit-tested
offline (no network, no real `/tmp`, no `/proc`):

```
src/cleanup.lib.mjs      ← pure logic: parsing, matching, classification, formatting
src/cleanup.os.lib.mjs   ← all OS/IO/network: fs, /proc, git, gh, screen/tmux, apt…
src/cleanup.mjs          ← CLI: option parsing, orchestration, reporting, prompt
tests/test-cleanup-1848.mjs  ← offline unit tests of cleanup.lib.mjs
```

This mirrors the existing repo convention (e.g. `solve.branch.lib.mjs` is pure
and import-safe, while network-heavy modules use `use-m`). `cleanup.lib.mjs`
imports only `isValidIssueBranchName` from `solve.branch.lib.mjs`, so the tests
run with no network. The network-dependent isolation-runner is **dynamically**
imported inside `cleanup.os.lib.mjs` only at runtime.

---

### R1 — A standalone `cleanup` command

- **Options:** (a) a flag on `solve`/`hive`; (b) a new bin.
- **Chosen:** new bin `cleanup` → `./src/cleanup.mjs`, registered in
  `package.json` `bin` between `task` and `review`. Matches the one-bin-per-tool
  convention (`solve`, `task`, `review`, …).

### R2 — `--dry-run` showing kept + deleted lists

- **Chosen:** `--dry-run` / `-n`. The command always computes the full
  classification and prints two sections — **🟢 KEPT** and **🗑️ WOULD DELETE**
  (or **TO DELETE** when not dry-running) — each sorted by size with a
  human-readable reason (`describeReason`), followed by a summary line
  (counts + reclaimable bytes). In dry-run nothing is deleted.

### R3 — `--keep-active-tasks-folders` (default on)

- **Options:** opt-in flag vs default-on with opt-out.
- **Chosen:** **default on** (safer), with `--no-keep-active-tasks-folders` to
  disable. Active tasks are discovered from two independent signals and merged:
  1. `/proc/<pid>/cmdline` scan for any `github.com/.../{issues,pull}/N` ref in a
     running process (`listActiveTaskRefsFromProc`);
  2. live isolation sessions: `screen -ls` / `tmux ls` → UUIDs →
     `$ --status <uuid>` → the `command` field
     (`listLiveSessionIds` + `listActiveTaskRefsFromSessions`).
     An independent third layer (`/proc/<pid>/cwd` + open fds via
     `listProcessHeldPaths`) keeps the _exact directory_ a live process is using,
     even if its command line doesn't contain a recognisable URL.

### R4 — Derive the branch "as per solve logic"

- **The crux of the issue.** A clone's directory name
  (`gh-issue-solver-<timestamp>`) carries no task identity; the identity is in
  its **git branch + remote**.
- **Chosen matching (`folderMatchesActiveTask`):**
  - **PR task:** resolve the head branch with `gh pr view N --json headRefName`
    (`resolvePrHeadBranch`) and match it **exactly** against the clone's current
    branch. This is why the gist's `/formal-ai/pull/387` correctly maps to
    `issue-386-0f7c7e8a730c`.
  - **Issue task:** the random hex suffix isn't known from the URL, so match the
    `issue-{number}-{hex}` **prefix** using the _same_ `isValidIssueBranchName()`
    helper `solve` uses, **scoped to the same owner/repo** (via `git remote -v`,
    parsed by `parseRemoteUrl`). This prevents `issue-42-*` in repo A from
    protecting an unrelated `issue-42-*` clone of repo B.
- Offline / `gh`-less fallback: PR matching degrades to the issue-prefix rule;
  `--no-resolve-branches` skips the `gh` call entirely.

### R5 — Keep `/tmp/start-command/` and other interfering places

- **Chosen:** two keep layers in `cleanup.lib.mjs`:
  - `DEFAULT_PROTECTED_NAMES = ['start-command']` — holds the isolation session
    logs that `$ --status`, `/log`, `/terminal_watch` depend on. Confirmed by the
    gist, where `/tmp/start-command/logs/...` is the live session's `logPath`.
  - `SYSTEM_PROTECTED_PATTERNS` — OS/desktop/runtime sockets and dirs
    (`.X11-unix`, `.ICE-unix`, `systemd-private-*`, `snap.*`, `dbus-*`, `ssh-*`,
    `hsperfdata_*`, `.org.chromium.*`, `.com.google.Chrome.*`, …) that are never
    removed unless `--include-system` is passed.

### R6 — Force deletion of `/tmp/start-command`

- **Chosen:** `--force-start-command`. When set, `start-command` falls through
  the protected check and is classified `remove` with reason
  `forced-start-command`. All other protected/system rules still apply.

### R7 — Cleanup for apt and other usual Ubuntu places

- **Chosen:** opt-in system actions in `runSystemCleanup`, each behind its own
  flag, fully dry-run aware (commands are _described_ in dry-run, never run):
  - `--apt` → `apt-get clean`, `apt-get autoclean -y`, `apt-get autoremove -y`
  - `--journal` → `journalctl --vacuum-time=2weeks`
  - `--docker` → `docker system prune -f`
  - `--npm` → `npm cache clean --force`
  - `--system` → shorthand for `--apt --journal --npm`
  - `--sudo` → prefix the package-manager commands with `sudo`
- These are **off by default**; the core of the command is the task-aware temp
  cleanup. (See [`research.md`](./research.md) §2 on why we don't rely on
  systemd-tmpfiles alone.)

### R8 — Safety (never break the running server)

Layered defences, highest precedence first (see `classifyEntry`):

1. `protected` — `DEFAULT_PROTECTED_NAMES` (unless forced).
2. `system-protected` — `SYSTEM_PROTECTED_PATTERNS` (unless `--include-system`).
3. `self` — the cleanup process's own clone / cwd / script dir
   (`computeSelfPaths`), so it can never delete itself.
4. `active-process` — any top-level temp entry held open or used as cwd by a
   live process (`/proc` scan).
5. `active-task` — matches a running task by branch/repo (R3/R4).
6. `dirty-worktree` — clones with uncommitted **or unpushed** changes are kept by
   default (`--no-keep-dirty` to override), so in-flight work is never lost.
7. Only then is a **recognised** hive-mind temp artifact removed.
8. Unrecognised entries are **kept** unless `--all`.
9. Unless `--force`, an interactive `yes` confirmation is required before any
   deletion, and every run writes a timestamped `cleanup-*.log`.

### R9 — Case study in `docs/case-studies/issue-1848/`

This folder: `README.md` (requirements), `research.md` (cited research),
`solution-plan.md` (this file), and `data/` (the gist log + issue snapshot).

### R10 — Reproducible tests

`tests/test-cleanup-1848.mjs` — 28 offline unit tests covering URL/command/remote
parsing, active-task matching (exact branch, issue-prefix+repo, negative cases),
hive-mind pattern recognition, the full reason-precedence of `classifyEntry`, an
end-to-end `classifyEntries` scenario that reproduces the gist (one active PR
clone kept, stale clones + MCP json removed, `start-command` and unrecognised
`android-sdk` kept), and the formatting/summary helpers.

### R11 — Single pull request

All work lands on `issue-1848-6e6905b2e594` → PR #1849.

---

## Existing components / libraries reviewed

Summarised from [`research.md`](./research.md) §3:

- **Deletion:** chose the built-in `fs.rm({recursive, force})` over `rimraf` /
  `del` / `trash` — the repo targets Node ≥ 24 and the target is Linux-only, so
  no dependency is warranted.
- **Sizing:** `du -sk` (matching the maintainer's manual `du -sh`) with an
  `fs.statSync` fallback.
- **OS cleaners (systemd-tmpfiles / tmpreaper):** complementary, age-based, and
  task-blind — kept as a backstop, not a replacement; their open-file-skipping
  safety behaviour is mirrored via `/proc` scanning.
- **Live-session truth:** reused the project's own `start-command` /
  `isolation-runner` (`$ --status`) and `gh` rather than re-implementing session
  or PR lookups.
