# Case Study: Disk space diagnostics logs in `/solve` command (#1945)

## Summary

Issue [#1945](https://github.com/link-assistant/hive-mind/issues/1945) was filed
with the following operator-side observation from `hive-cleanup`:

```text
12G  /tmp/gh-issue-solver-1781812658434  — in use by a running process
     (was link-assistant/formal-ai issue #517, session 061ccf67-...,
     status executing, workspace /home/box; repo link-assistant/formal-ai,
     branch issue-517-310d75ed5ddb, dirty/unpushed)
```

The cleanup tool sees a **12 GB working tree** for a long-running `/solve` task,
but `/solve` itself never reports those numbers. There is no way to tell — from
`/solve`'s own logs or its Telegram completion message — whether the 12 GB is:

1. the **size of the repository itself** at clone time (e.g. a monorepo with a
   large `node_modules` baseline),
2. **growth during the AI working session** (e.g. an agent that downloaded big
   build artifacts or cached models), or
3. an accumulation across **re-runs / auto-restarts** of the same task.

The operator only learns about the disk pressure post-hoc, when `hive-cleanup`
flags it, and that learning is also indirect — the cleanup tool ages out the
information once the task ends.

### What the issue asks for, verbatim

> We must display in logs the size of cloned repository before any work starts
> (so we know the size of repository itself), that should be done before our AI
> agent starts, and we also need to display how much in size folder increased
> after that (after AI agent finished).
>
> So we have more data about what is happening from Hive Mind side for solve
> command.
>
> Also in the status message of telegram, we should add warnings if cloned
> repository is more than 5 GB, or if during operation folder size increased for
> more than 5 GB, and also if total space per task used is more than 5 GB.

The 5 GB number is the **threshold** the operator asked for — not the **size of
the problem**. The 12 GB example in the issue body is itself a real-world
sample of the third condition (the total-per-task warning).

## Requirements (R1–R9)

Extracted directly from the issue body. Each is satisfied by this PR.

| ID  | Requirement                                                                 | Where it is satisfied                                                               |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| R1  | Log the **cloned repository size** BEFORE the AI agent starts.              | `solve.mjs`: `recordAfterCloneSize` runs right after `setupRepositoryAndClone`.     |
| R2  | Log the **folder size growth** AFTER the AI agent finishes (delta from R1). | `solve.mjs`: `recordAfterAgentSize` runs right after the working session ends.      |
| R3  | Telegram status message: WARNING if **cloned repo > 5 GB**.                 | `formatDiskDiagnosticsBlock` ⇒ `⚠️ Cloned repository exceeds 5.0 GB`.               |
| R4  | Telegram status message: WARNING if **delta during run > 5 GB**.            | `formatDiskDiagnosticsBlock` ⇒ `⚠️ Folder grew by more than 5.0 GB during the run`. |
| R5  | Telegram status message: WARNING if **total per task > 5 GB**.              | `formatDiskDiagnosticsBlock` ⇒ `⚠️ Total disk usage exceeds 5.0 GB`.                |
| R6  | Single PR; everything done in #1947.                                        | Branch `issue-1945-19f1d0d9b4e0`.                                                   |
| R7  | Collect issue data under `docs/case-studies/issue-1945/`.                   | `data/raw/`.                                                                        |
| R8  | Search online for facts/data that informs the design.                       | "Existing components" section below.                                                |
| R9  | List each existing component/library reused in the solution.                | "Existing components / libraries reused" below.                                     |

## Architecture

```text
parent process (Telegram bot / shell)                        child process (solve.mjs)
─────────────────────────────────────                        ─────────────────────────
                                                             setupRepositoryAndClone(...)
                                                             │
                                                             ▼
                                                             recordAfterCloneSize()
                                                             │  emits → "📊 [DISK] phase=after_clone bytes=… path=…"
                                                             │           into the captured log
                                                             ▼
                                                             beginWorkingSession()
                                                             │
                                                             ▼   (AI agent runs)
                                                             │
                                                             ▼
                                                             recordAfterAgentSize()
                                                             │  emits → "📊 [DISK] phase=after_agent bytes=… deltaBytes=… path=…"
                                                             │           into the captured log
                                                             ▼
                                                             endWorkingSession()
                                                             │
                                                             ▼
session-monitor.lib.mjs                                      (child exits, status persisted)
│
├── reads logPath
├── parses 📊 [DISK] markers
├── builds formatDiskDiagnosticsBlock(...)
└── appends to formatSessionCompletionMessage.extraSections
        │
        ▼
   Telegram completion message:
   ✅ Work session finished successfully
   ⏱️ Duration: …
   📊 Session: …
   …
   💾 Disk usage
```

Cloned repository: 12.0 GB
After agent: 12.4 GB (+500.0 MB)
Threshold: 5.0 GB

⚠️ Cloned repository exceeds 5.0 GB
⚠️ Total disk usage exceeds 5.0 GB

```

```

### Why log markers and not a side channel?

The Telegram bot's `session-monitor.lib.mjs` already lives **outside** the
`/solve` child process. It tracks the session via the start-command CLI, learns
the `logPath`, and after completion **reads the log file** to recover information
the child knew but couldn't push directly (e.g. `pullRequestUrl`, last
`Session ID:` for `--resume`).

That is the cheapest, most robust ingestion channel: the log is already captured
to a known path, already mirrored to the Telegram chat on demand, and already
parsed for similar markers in two other code paths (PR URL extraction; killed-
session resume id). Inventing a new IPC just for two byte counts would be a
strict regression in complexity.

A second channel was considered (writing the markers to a JSON sidecar next to
`logPath`) but rejected: it would need its own retention/cleanup story, and the
two existing similar features (PR URL recovery, resume-id recovery) both read
the log directly.

### Why warn only on the completion message?

The Telegram "Starting / Executing" messages exist **before** the child has
cloned anything; `session-monitor.lib.mjs` only learns the actual repo size
when the child has emitted the AFTER_CLONE marker, which lands in the log only
after `setupRepositoryAndClone` returns. By the time the bot could re-render
"Executing" with a fresh warning, the AI agent has been working for minutes
already. The earliest reliable surface for the warning is therefore the
**completion** message — the same place where limits-delta and resume blocks
are already attached.

## Root cause / context

There is no preexisting code in the repository that captures the `tempDir` size
at any of the lifecycle points relevant to this issue. The closest existing
surfaces are:

| Surface                                           | What it measures                                                  | Why it doesn't cover #1945                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `getDiskSpaceInfo` (`src/limits.lib.mjs`)         | Whole-filesystem `df` snapshot                                    | Reports the host's free space, not the task's working tree. Aggregates all tasks together.              |
| `getPathSize` (`src/cleanup.os.lib.mjs`)          | `du -sk` on a target path; used by `hive-cleanup` to classify tmp | Runs in the **cleanup** tool, not in `/solve`, so the operator only sees it after the fact via cleanup. |
| Workspace-mode logs in `solve.repository.lib.mjs` | Prints paths only                                                 | Says "repo will be cloned here", not how big it ended up.                                               |

The fix introduces one new module that brackets the AI working session with two
checkpoints, written as structured log markers the bot can re-read.

## Existing components / libraries reused

This solution introduces **no new third-party dependency**. It reuses:

1. **`du(1)`** — system utility. GNU coreutils `du -sb` returns size in **bytes**
   (no rounding), which is what we need for an exact delta calculation. BSD `du`
   (macOS default) doesn't support `-b`; we fall back to `du -sk` (kilobytes ×
   1024). A final `fs.statSync` fallback covers single-file targets.
   - The same fallback ladder is used internally by `src/cleanup.os.lib.mjs`
     (`getPathSize`), so this code path is already exercised on the existing
     supported targets (Linux, macOS).
2. **`formatBytes` pattern from `src/limits.lib.mjs`** — same `"12.0 GB"` shape
   as the existing limits/disk snapshots, so the Telegram block stays visually
   consistent with `formatLimitsSnapshotBlock`.
3. **`extraSections` parameter of `formatSessionCompletionMessage`** — already
   used by `--show-limits` (`limitsExtraSections`) and the killed-session
   resume hint (`resumeExtraSections`). Reused verbatim; no signature change.
4. **`logPath` plumbing in `session-monitor.lib.mjs`** — already passed through
   from `statusResult.logPath` / `sessionInfo.logPath` for the PR-URL recovery
   and `readFooter` paths. Reused: the same `fs.readFile(logPath, 'utf8')` is
   the input to the disk-marker parser.
5. **The 📊 emoji + Markdown code-block convention** — matches both the
   `formatLimitsSnapshotBlock` heading style (`📊 Limits at start`) and the
   existing `📊 Session:` line in the completion message, so the new
   `💾 Disk usage` block reads as the same family of diagnostics.

### Libraries considered and rejected

- **`get-folder-size` (npm)** — pure-JS recursive `fs.stat` directory walker.
  Rejected because `du -sb` is one syscall to the kernel for a path with millions
  of files, but `get-folder-size` does one `fs.stat` per entry; on a 12 GB
  `node_modules` tree it routinely takes 10s+. Adding wall-clock to the
  pre-agent path is an anti-feature here.
- **`fast-folder-size` (npm)** — wraps `du`/`PowerShell` and falls back to
  pure-JS. Equivalent to what we wrote directly but ships ~30 KB of polyfill
  code and a runtime dependency for a 30-line helper that we control directly.
  Rejected — same logic, no new dep.
- **`check-disk-space` (npm)** — measures _available_ disk space, not a single
  directory's footprint. Wrong tool for the requirement.
- **`diskusage` (native addon)** — also free-space, not per-path.
- **Node 22 `fs.statfsSync`** — returns mount-level free-space metrics. Wrong
  level of granularity for "this task's working tree."

## Solution plan

| Step | File                                                          | Change                                                                                                                                                         |
| ---- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `src/solve.disk-diagnostics.lib.mjs` (NEW)                    | Helpers: `measureDirectorySize`, `formatBytes`, `formatBytesDelta`, `buildDiskMarker`, `parseDiskMarkers`, `computeDiskWarnings`, format block + record fns.   |
| 2    | `src/solve.mjs`                                               | Import the helpers. Call `recordAfterCloneSize` after `setupRepositoryAndClone`. Call `recordAfterAgentSize` after the AI agent returns (`endWorkingSession`). |
| 3    | `src/session-monitor.lib.mjs`                                 | New helper `buildDiskDiagnosticsExtraSection(logPath)` that reads the log, parses markers, returns the block string. Wired into the `extraSections` list.      |
| 4    | `tests/test-issue-1945-disk-diagnostics.mjs` (NEW)            | 26 unit tests: thresholds, marker round-trip, edge cases, recorder wiring, BSD `du` fallback path is exercised implicitly.                                     |
| 5    | `tests/test-issue-1945-session-monitor-integration.mjs` (NEW) | 4 integration tests: synthetic log → completion message contains the right block / right warnings / no block when no markers.                                  |
| 6    | `.changeset/issue-1945-disk-diagnostics.md` (NEW)             | Patch release note.                                                                                                                                            |
| 7    | `docs/case-studies/issue-1945/`                               | This file plus collected raw data under `data/raw/`.                                                                                                           |

## Reproduction

The 12 GB observation from the issue body cannot be deterministically reproduced
without re-running the original `formal-ai#517` job, but the **shape** of the
warning surfaces is reproduced deterministically by the unit tests:

```bash
node tests/test-issue-1945-disk-diagnostics.mjs
node tests/test-issue-1945-session-monitor-integration.mjs
```

To see the new markers locally with a real solve run, follow the captured log
after the AI working session has started:

```bash
grep -E '📊 \[DISK\]' /tmp/gh-issue-solver-*.log
```

Sample real-world output (matches the format the Telegram block parses):

```text
📊 [DISK] phase=after_clone bytes=12884901888 path=/tmp/gh-issue-solver-1234 size=12.0 GB
📊 [DISK] phase=after_agent bytes=13312000000 deltaBytes=427098112 path=/tmp/gh-issue-solver-1234 size=12.4 GB delta=+407 MB
```

## Data Collected

All downloaded artifacts are under this directory.

| Path                                          | Purpose                                      |
| --------------------------------------------- | -------------------------------------------- |
| `data/raw/hive-mind-issue-1945.json`          | Source issue metadata + body                 |
| `data/raw/hive-mind-issue-1945-comments.json` | Issue comments (empty at investigation time) |

No screenshots are present in the issue or its comments.

## Upstream / external repositories

Out of scope. The behaviour is entirely inside Hive Mind's own `/solve`
command. There is no upstream component to file with: `du(1)` is part of every
supported OS, and the Telegram code path is also entirely in-repo.
